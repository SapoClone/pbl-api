import { Injectable } from '@nestjs/common';
import { EventEnvelope, TenantContext } from '@pbl/common';
import { SALES_SHIFT_CLOSED, SalesShiftEventPayload } from '@pbl/contracts';
import { OnEvent } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  assertMakerCheckerSeparation,
  evaluateShiftCashReconciliation,
  FinanceDomainError,
  FinanceDomainErrorCode,
  GL_ACCOUNT_CODES,
  parseVnd,
} from '../../domain/finance-domain';
import { nextFinanceDocumentCode } from '../../infrastructure/persistence/finance-code.generator';
import {
  CashAccountEntity,
  CashbookEntryEntity,
  CodReceivableEntity,
  CustomerCreditProfileEntity,
  CustomerReceivableEntity,
  FinancialAdjustmentEntity,
  FinancialJournalEntity,
  PaymentSettlementEntity,
  ReconciliationIssueEntity,
  ReconciliationRunEntity,
  RefundOperationEntity,
  ShiftCashReconciliationEntity,
  SupplierPayableEntity,
} from '../../infrastructure/persistence/finance.entities';
import { applyBranchScope, BranchScope } from '../../presentation/branch-scope';
import { CashAccountsService } from '../cash-accounts/cash-accounts.service';
import { CashbookService } from '../cashbook/cashbook.service';
import { FinancialJournalService } from '../financial-journal/financial-journal.service';
import {
  CreateFinancialAdjustmentDto,
  ListReconciliationIssuesQueryDto,
  ReconcileShiftCashDto,
  ResolveReconciliationIssueDto,
  TriggerReconciliationRunDto,
} from './reconciliation.dto';

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly journalService: FinancialJournalService,
    private readonly cashAccountsService: CashAccountsService,
    private readonly cashbookService: CashbookService,
  ) {}

  private async runInTenantTx<T>(
    tenantId: string,
    fn: (em: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return fn(em);
    });
  }

  async reconcileShiftCash(
    actorId: string,
    dto: ReconcileShiftCashDto,
    tenantId = TenantContext.require(),
  ): Promise<{
    reconciliation: ShiftCashReconciliationEntity;
    replayed: boolean;
  }> {
    return this.runInTenantTx(tenantId, async (em) =>
      this.reconcileShiftCashInTx(em, tenantId, actorId, dto),
    );
  }

  async reconcileShiftCashInTx(
    em: EntityManager,
    tenantId: string,
    actorId: string,
    dto: ReconcileShiftCashDto,
  ): Promise<{
    reconciliation: ShiftCashReconciliationEntity;
    replayed: boolean;
  }> {
    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `shift-recon:${tenantId}:${dto.shiftId}`,
    ]);

    const repo = em.getRepository(ShiftCashReconciliationEntity);
    const existing = await repo.findOne({
      where: { tenantId, shiftId: dto.shiftId },
    });
    if (existing) {
      return { reconciliation: existing, replayed: true };
    }

    const evalResult = evaluateShiftCashReconciliation({
      openingCash: dto.openingCash,
      confirmedCashSales: dto.confirmedCashSales,
      confirmedCashRefunds: dto.confirmedCashRefunds ?? 0,
      otherCashReceipts: dto.otherCashReceipts ?? 0,
      otherCashExpenses: dto.otherCashExpenses ?? 0,
      actualCountedCash: dto.actualCountedCash,
    });

    const reconId = randomUUID();
    const shiftCode =
      dto.shiftCode ?? (await nextFinanceDocumentCode(em, tenantId, 'REC'));
    const varianceVnd = parseVnd(evalResult.varianceAmount, {
      allowZero: true,
      allowNegative: true,
      field: 'varianceAmount',
    });

    let varianceJournalId: string | null = null;
    let reconciliationIssueId: string | null = null;
    let cashAccount: CashAccountEntity | null = null;

    if (dto.cashAccountId) {
      cashAccount = await em.getRepository(CashAccountEntity).findOne({
        where: { id: dto.cashAccountId, tenantId },
      });
    } else {
      cashAccount = await this.cashAccountsService.ensureDefaultCashAccountInTx(
        em,
        tenantId,
        dto.branchId,
        'CASH_DRAWER',
      );
    }

    if (varianceVnd !== 0) {
      const absVariance = varianceVnd < 0 ? -varianceVnd : varianceVnd;
      const absVarianceStr = absVariance;
      const isShortage = varianceVnd < 0;
      const cashGl =
        cashAccount?.glAccountCode ?? GL_ACCOUNT_CODES.CASH_ON_HAND;

      const postedJournal = await this.journalService.postJournalInTx(
        em,
        tenantId,
        {
          journalType: 'SHIFT_CASH_VARIANCE',
          sourceType: 'SHIFT_CASH_RECONCILIATION',
          sourceId: reconId,
          idempotencyKey: `shift-jnl:${dto.shiftId}`,
          branchId: dto.branchId,
          description: isShortage
            ? `POS shift ${shiftCode} cash shortage (${absVarianceStr})`
            : `POS shift ${shiftCode} cash overage (${absVarianceStr})`,
          postedBy: actorId,
          lines: isShortage
            ? [
                {
                  accountCode: GL_ACCOUNT_CODES.CASH_VARIANCE,
                  debitAmount: absVarianceStr,
                  branchId: dto.branchId,
                  memo: `Shift ${shiftCode} cash shortage`,
                },
                {
                  accountCode: cashGl,
                  creditAmount: absVarianceStr,
                  branchId: dto.branchId,
                  memo: `Adjust cash on hand for shift ${shiftCode} shortage`,
                },
              ]
            : [
                {
                  accountCode: cashGl,
                  debitAmount: absVarianceStr,
                  branchId: dto.branchId,
                  memo: `Adjust cash on hand for shift ${shiftCode} overage`,
                },
                {
                  accountCode: GL_ACCOUNT_CODES.OTHER_INCOME,
                  creditAmount: absVarianceStr,
                  branchId: dto.branchId,
                  memo: `Shift ${shiftCode} cash overage`,
                },
              ],
        },
      );
      varianceJournalId = postedJournal.journal.id;

      if (cashAccount) {
        await this.cashbookService.createAndOptionallyPostVoucherInTx(
          em,
          tenantId,
          {
            actorId,
            direction: isShortage ? 'EXPENSE' : 'RECEIPT',
            cashAccountId: cashAccount.id,
            categoryCode: isShortage ? 'OPERATING_EXPENSE' : 'OTHER_RECEIPT',
            amount: absVarianceStr,
            branchId: dto.branchId,
            shiftId: dto.shiftId,
            voucherType: 'SHIFT_CASH_VARIANCE',
            sourceType: 'SHIFT_CASH_RECONCILIATION',
            sourceId: reconId,
            description: isShortage
              ? `Shift ${shiftCode} cash shortage adjustment`
              : `Shift ${shiftCode} cash overage adjustment`,
            referenceDoc: shiftCode,
            autoPost: true,
            idempotencyKey: `shift-cb:${dto.shiftId}`,
            skipJournalIfLinked: postedJournal.journal.id,
          },
        );
      }

      const issue = await em.getRepository(ReconciliationIssueEntity).save(
        em.getRepository(ReconciliationIssueEntity).create({
          id: randomUUID(),
          tenantId,
          runId: null,
          issueType: isShortage ? 'SHIFT_CASH_SHORTAGE' : 'SHIFT_CASH_OVERAGE',
          severity: isShortage ? 'MEDIUM' : 'LOW',
          sourceType: 'SHIFT_CASH_RECONCILIATION',
          sourceId: reconId,
          expectedAmount: evalResult.expectedClosingCash,
          actualAmount: evalResult.actualCountedCash,
          differenceAmount: evalResult.varianceAmount,
          status: 'OPEN',
          description: `POS shift ${shiftCode} recorded variance of ${evalResult.varianceAmount}`,
          resolutionNote: null,
          resolvedBy: null,
          resolvedAt: null,
        }),
      );
      reconciliationIssueId = issue.id;
    }

    const reconciliation = repo.create({
      id: reconId,
      tenantId,
      shiftId: dto.shiftId,
      shiftCode,
      branchId: dto.branchId,
      cashAccountId: cashAccount?.id ?? null,
      staffId: dto.staffId ?? actorId,
      openingCash: evalResult.openingCash,
      confirmedCashSales: evalResult.confirmedCashSales,
      confirmedCashRefunds: evalResult.confirmedCashRefunds,
      otherCashReceipts: evalResult.otherCashReceipts,
      otherCashExpenses: evalResult.otherCashExpenses,
      expectedClosingCash: evalResult.expectedClosingCash,
      actualCountedCash: evalResult.actualCountedCash,
      varianceAmount: evalResult.varianceAmount,
      status: evalResult.status,
      varianceJournalId,
      reconciliationIssueId,
      reconciledBy: actorId,
      reconciledAt: new Date(),
    });

    const saved = await repo.save(reconciliation);
    return { reconciliation: saved, replayed: false };
  }

  async listShiftReconciliations(
    branchId?: string,
    tenantId = TenantContext.require(),
    scope: BranchScope = null,
  ): Promise<ShiftCashReconciliationEntity[]> {
    return this.runInTenantTx(tenantId, async (em) => {
      const where: Record<string, unknown> = {
        tenantId,
        ...(branchId ? { branchId } : {}),
      };
      applyBranchScope(where, scope);
      return em.getRepository(ShiftCashReconciliationEntity).find({
        where,
        order: { createdAt: 'DESC' },
      });
    });
  }

  async createAdjustment(
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: CreateFinancialAdjustmentDto,
    tenantId = TenantContext.require(),
  ): Promise<{ adjustment: FinancialAdjustmentEntity; replayed: boolean }> {
    const amountVnd = parseVnd(dto.amount, {
      allowZero: false,
      field: 'amount',
    });
    const cleanKey = (
      idempotencyKeyHeader ??
      dto.idempotencyKey ??
      `adj:${dto.targetType}:${dto.targetId}:${amountVnd}:${randomUUID()}`
    )
      .trim()
      .toLowerCase();

    return this.runInTenantTx(tenantId, async (em) => {
      const repo = em.getRepository(FinancialAdjustmentEntity);
      const existing = await repo.findOne({
        where: { tenantId, idempotencyKey: cleanKey },
      });
      if (existing) {
        return { adjustment: existing, replayed: true };
      }

      const code = await nextFinanceDocumentCode(em, tenantId, 'ADJ');
      const adjustment = repo.create({
        id: randomUUID(),
        tenantId,
        code,
        adjustmentType: dto.adjustmentType.trim().toUpperCase(),
        targetType: dto.targetType,
        targetId: dto.targetId,
        amount: amountVnd,
        direction: dto.direction,
        reasonCode: dto.reasonCode.trim().toUpperCase(),
        explanation: dto.explanation.trim(),
        status: 'PENDING_APPROVAL',
        journalId: null,
        idempotencyKey: cleanKey,
        requestedBy: actorId,
        approvedBy: null,
        rejectedBy: null,
        approvedAt: null,
        postedAt: null,
      });

      const saved = await repo.save(adjustment);
      return { adjustment: saved, replayed: false };
    });
  }

  async approveAdjustment(
    adjustmentId: string,
    approverId: string,
    tenantId = TenantContext.require(),
  ): Promise<FinancialAdjustmentEntity> {
    return this.runInTenantTx(tenantId, async (em) => {
      const repo = em.getRepository(FinancialAdjustmentEntity);
      const adjustment = await repo.findOne({
        where: { id: adjustmentId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!adjustment) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.ADJUSTMENT_NOT_FOUND,
          `Financial adjustment ${adjustmentId} not found`,
          404,
        );
      }

      if (adjustment.status === 'POSTED') {
        return adjustment;
      }

      assertMakerCheckerSeparation(
        adjustment.requestedBy,
        approverId,
        'financial adjustment',
      );

      const { debitGl, creditGl } = this.resolveAdjustmentAccounts(
        adjustment.targetType,
        adjustment.direction,
      );

      const postedJournal = await this.journalService.postJournalInTx(
        em,
        tenantId,
        {
          journalType: 'FINANCIAL_ADJUSTMENT',
          sourceType: 'FINANCIAL_ADJUSTMENT',
          sourceId: adjustment.id,
          idempotencyKey: `adj-jnl:${adjustment.id}`,
          description: `Approved financial adjustment ${adjustment.code}: ${adjustment.explanation}`,
          postedBy: approverId,
          lines: [
            {
              accountCode: debitGl,
              debitAmount: adjustment.amount,
              referenceType: adjustment.targetType,
              referenceId: adjustment.targetId,
              memo: adjustment.explanation,
            },
            {
              accountCode: creditGl,
              creditAmount: adjustment.amount,
              referenceType: adjustment.targetType,
              referenceId: adjustment.targetId,
              memo: adjustment.explanation,
            },
          ],
        },
      );

      const now = new Date();
      adjustment.status = 'POSTED';
      adjustment.approvedBy = approverId;
      adjustment.journalId = postedJournal.journal.id;
      adjustment.approvedAt = now;
      adjustment.postedAt = now;

      return repo.save(adjustment);
    });
  }

  async listAdjustments(
    tenantId = TenantContext.require(),
  ): Promise<FinancialAdjustmentEntity[]> {
    return this.runInTenantTx(tenantId, async (em) =>
      em.getRepository(FinancialAdjustmentEntity).find({
        where: { tenantId },
        order: { createdAt: 'DESC' },
      }),
    );
  }

  async triggerReconciliationRun(
    actorId: string,
    dto: TriggerReconciliationRunDto,
    tenantId = TenantContext.require(),
  ): Promise<{
    run: ReconciliationRunEntity;
    issues: ReconciliationIssueEntity[];
  }> {
    return this.runInTenantTx(tenantId, async (em) => {
      const reconciliationType = (
        dto.reconciliationType ?? 'FULL_SYSTEM'
      ).toUpperCase();
      const code = await nextFinanceDocumentCode(em, tenantId, 'REC');
      const runId = randomUUID();
      const startedAt = new Date();

      let processedCount = 0;
      let matchedVnd = 0;
      let mismatchedVnd = 0;
      let issueCount = 0;

      // 1. Check all journals are balanced
      const journals = await em
        .getRepository(FinancialJournalEntity)
        .find({ where: { tenantId } });
      for (const jnl of journals) {
        processedCount += 1;
        const dVnd = parseVnd(jnl.totalDebit, {
          allowZero: true,
          field: 'totalDebit',
        });
        const cVnd = parseVnd(jnl.totalCredit, {
          allowZero: true,
          field: 'totalCredit',
        });
        if (dVnd === cVnd) {
          matchedVnd += dVnd;
        } else {
          mismatchedVnd += dVnd > cVnd ? dVnd - cVnd : cVnd - dVnd;
          issueCount += 1;
        }
      }

      // 2. Check payment settlements requiring reconciliation
      const settlements = await em
        .getRepository(PaymentSettlementEntity)
        .find({ where: { tenantId } });
      for (const stl of settlements) {
        processedCount += 1;
        const reqVnd = parseVnd(stl.requestedAmount, {
          allowZero: true,
          field: 'requestedAmount',
        });
        if (stl.settlementStatus === 'RECONCILIATION_REQUIRED') {
          mismatchedVnd += reqVnd;
          issueCount += 1;
          await this.ensureIssueTrackedByRunInTx(em, tenantId, runId, {
            sourceType: 'PAYMENT_SETTLEMENT',
            sourceId: stl.id,
            issueType: 'AMBIGUOUS_SETTLEMENT',
            expectedAmount: stl.requestedAmount,
            actualAmount: stl.confirmedAmount,
            differenceAmount:
              parseVnd(stl.confirmedAmount, { allowZero: true }) - reqVnd,
            description: `Payment settlement ${stl.code} for order ${stl.orderId} requires reconciliation`,
          });
        } else {
          matchedVnd += reqVnd;
        }
      }

      // 3. Check refund operations in PENDING_CONFIRMATION or RECONCILIATION_REQUIRED
      const refunds = await em
        .getRepository(RefundOperationEntity)
        .find({ where: { tenantId } });
      for (const rf of refunds) {
        processedCount += 1;
        const amtVnd = parseVnd(rf.amount, {
          allowZero: true,
          field: 'amount',
        });
        if (
          rf.status === 'PENDING_CONFIRMATION' ||
          rf.status === 'RECONCILIATION_REQUIRED'
        ) {
          mismatchedVnd += amtVnd;
          issueCount += 1;
          await this.ensureIssueTrackedByRunInTx(em, tenantId, runId, {
            sourceType: 'REFUND_OPERATION',
            sourceId: rf.id,
            issueType: 'REFUND_PROVIDER_TIMEOUT',
            expectedAmount: rf.amount,
            actualAmount: 0,
            differenceAmount: rf.amount,
            description: `Refund ${rf.code} is in ${rf.status}`,
          });
        } else {
          matchedVnd += amtVnd;
        }
      }

      // 4. Check COD receivables with discrepancies
      const cods = await em
        .getRepository(CodReceivableEntity)
        .find({ where: { tenantId } });
      for (const cod of cods) {
        processedCount += 1;
        const expVnd = parseVnd(cod.expectedCodAmount, {
          allowZero: true,
          field: 'expectedCodAmount',
        });
        if (cod.status === 'DISCREPANCY') {
          mismatchedVnd += expVnd;
          issueCount += 1;
          await this.ensureIssueTrackedByRunInTx(em, tenantId, runId, {
            sourceType: 'COD_RECEIVABLE',
            sourceId: cod.id,
            issueType: 'COD_SETTLEMENT_DISCREPANCY',
            expectedAmount: cod.expectedNetAmount,
            actualAmount: cod.actualRemittedAmount,
            differenceAmount: cod.discrepancyAmount,
            description: `COD receivable ${cod.trackingNumber} has discrepancy ${cod.discrepancyAmount}`,
          });
        } else {
          matchedVnd += expVnd;
        }
      }

      // 5. Check customer credit profile vs open receivables subledger integrity
      const profiles = await em
        .getRepository(CustomerCreditProfileEntity)
        .find({ where: { tenantId } });
      for (const profile of profiles) {
        processedCount += 1;
        const openAr = await em
          .getRepository(CustomerReceivableEntity)
          .find({ where: { tenantId, customerId: profile.customerId } });
        const sumOpenVnd = openAr.reduce(
          (sum, r) =>
            r.status === 'OPEN' || r.status === 'PARTIALLY_PAID'
              ? sum +
                parseVnd(r.outstandingAmount, {
                  allowZero: true,
                  field: 'outstandingAmount',
                })
              : sum,
          0,
        );
        const postedDebtVnd = parseVnd(profile.postedDebt, {
          allowZero: true,
          field: 'postedDebt',
        });
        if (sumOpenVnd === postedDebtVnd) {
          matchedVnd += sumOpenVnd;
        } else {
          mismatchedVnd +=
            sumOpenVnd > postedDebtVnd
              ? sumOpenVnd - postedDebtVnd
              : postedDebtVnd - sumOpenVnd;
          issueCount += 1;
          await this.ensureIssueTrackedByRunInTx(em, tenantId, runId, {
            sourceType: 'CUSTOMER_CREDIT_PROFILE',
            sourceId: profile.id,
            issueType: 'SUBLEDGER_AR_MISMATCH',
            expectedAmount: sumOpenVnd,
            actualAmount: profile.postedDebt,
            differenceAmount: postedDebtVnd - sumOpenVnd,
            description: `Customer ${profile.customerId} credit profile postedDebt (${profile.postedDebt}) differs from open receivables (${sumOpenVnd})`,
          });
        }
      }

      const run = await em.getRepository(ReconciliationRunEntity).save(
        em.getRepository(ReconciliationRunEntity).create({
          id: runId,
          tenantId,
          code,
          reconciliationType,
          status: issueCount === 0 ? 'COMPLETED' : 'COMPLETED_WITH_ISSUES',
          processedCount,
          matchedAmount: matchedVnd,
          mismatchedAmount: mismatchedVnd,
          issueCount,
          startedBy: actorId,
          startedAt,
          completedAt: new Date(),
        }),
      );

      const issues = await em.getRepository(ReconciliationIssueEntity).find({
        where: { tenantId, status: 'OPEN' },
        order: { createdAt: 'DESC' },
      });

      return { run, issues };
    });
  }

  async getReconciliationRunById(
    id: string,
    tenantId = TenantContext.require(),
  ): Promise<{
    run: ReconciliationRunEntity;
    issues: ReconciliationIssueEntity[];
  }> {
    return this.runInTenantTx(tenantId, async (em) => {
      const run = await em
        .getRepository(ReconciliationRunEntity)
        .findOne({ where: { id, tenantId } });
      if (!run) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.VALIDATION_ERROR,
          `Reconciliation run ${id} not found`,
          404,
        );
      }
      const issues = await em.getRepository(ReconciliationIssueEntity).find({
        where: { tenantId, runId: run.id },
        order: { createdAt: 'DESC' },
      });
      return { run, issues };
    });
  }

  async listReconciliationIssues(
    query: ListReconciliationIssuesQueryDto,
    tenantId = TenantContext.require(),
  ) {
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    return this.runInTenantTx(tenantId, async (em) => {
      const where: Record<string, unknown> = { tenantId };
      if (query.status) {
        where.status = query.status;
      }
      if (query.issueType) {
        where.issueType = query.issueType;
      }
      const [items, total] = await em
        .getRepository(ReconciliationIssueEntity)
        .findAndCount({
          where,
          order: { createdAt: 'DESC', id: 'DESC' },
          take: limit,
          skip: offset,
        });
      return {
        data: items,
        pagination: { limit, offset, total },
      };
    });
  }

  async resolveReconciliationIssue(
    id: string,
    actorId: string,
    dto: ResolveReconciliationIssueDto,
    tenantId = TenantContext.require(),
  ): Promise<ReconciliationIssueEntity> {
    return this.runInTenantTx(tenantId, async (em) => {
      const repo = em.getRepository(ReconciliationIssueEntity);
      const issue = await repo.findOne({
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!issue) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.VALIDATION_ERROR,
          `Reconciliation issue ${id} not found`,
          404,
        );
      }
      issue.status = dto.status ?? 'RESOLVED';
      issue.resolutionNote = dto.resolutionNote.trim();
      issue.resolvedBy = actorId;
      issue.resolvedAt = new Date();
      return repo.save(issue);
    });
  }

  async getFinanceSummary(
    tenantId = TenantContext.require(),
    scope: BranchScope = null,
  ) {
    return this.runInTenantTx(tenantId, async (em) => {
      const scoped = (extra: Record<string, unknown> = {}) => {
        const where: Record<string, unknown> = { tenantId, ...extra };
        applyBranchScope(where, scope);
        return where;
      };
      const cashAccounts = await em
        .getRepository(CashAccountEntity)
        .find({ where: scoped({ status: 'ACTIVE' }) });
      const totalCashVnd = cashAccounts.reduce(
        (sum, acc) =>
          sum +
          parseVnd(acc.currentBalance, {
            allowZero: true,
            allowNegative: true,
            field: 'currentBalance',
          }),
        0,
      );

      const cashbookEntries = await em
        .getRepository(CashbookEntryEntity)
        .find({ where: scoped({ status: 'POSTED' }) });
      let totalReceiptsVnd = 0;
      let totalExpensesVnd = 0;
      for (const entry of cashbookEntries) {
        const amt = parseVnd(entry.amount, {
          allowZero: true,
          field: 'amount',
        });
        if (entry.direction === 'RECEIPT') {
          totalReceiptsVnd += amt;
        } else {
          totalExpensesVnd += amt;
        }
      }

      const receivables = await em
        .getRepository(CustomerReceivableEntity)
        .find({ where: scoped() });
      let openArVnd = 0;
      let openArCount = 0;
      for (const r of receivables) {
        if (r.status === 'OPEN' || r.status === 'PARTIALLY_PAID') {
          openArVnd += parseVnd(r.outstandingAmount, {
            allowZero: true,
            field: 'outstandingAmount',
          });
          openArCount += 1;
        }
      }

      const payables = await em
        .getRepository(SupplierPayableEntity)
        .find({ where: { tenantId } });
      let openApVnd = 0;
      let openApCount = 0;
      for (const p of payables) {
        if (p.status === 'OPEN' || p.status === 'PARTIALLY_PAID') {
          openApVnd += parseVnd(p.outstandingAmount, {
            allowZero: true,
            field: 'outstandingAmount',
          });
          openApCount += 1;
        }
      }

      const cods = await em
        .getRepository(CodReceivableEntity)
        .find({ where: scoped() });
      let pendingCodVnd = 0;
      let reconciledCodNetVnd = 0;
      let codDiscrepancyCount = 0;
      for (const c of cods) {
        if (
          c.status === 'COD_RECEIVABLE_RECOGNIZED' ||
          c.status === 'SETTLEMENT_EXPECTED'
        ) {
          pendingCodVnd += parseVnd(c.expectedCodAmount, {
            allowZero: true,
            field: 'expectedCodAmount',
          });
        } else if (c.status === 'RECONCILED') {
          reconciledCodNetVnd += parseVnd(c.actualRemittedAmount, {
            allowZero: true,
            allowNegative: true,
            field: 'actualRemittedAmount',
          });
        } else if (c.status === 'DISCREPANCY') {
          codDiscrepancyCount += 1;
        }
      }

      const refunds = await em
        .getRepository(RefundOperationEntity)
        .find({ where: scoped() });
      let completedRefundVnd = 0;
      let pendingReconRefundCount = 0;
      for (const rf of refunds) {
        if (rf.status === 'COMPLETED') {
          completedRefundVnd += parseVnd(rf.amount, {
            allowZero: true,
            field: 'amount',
          });
        } else if (
          rf.status === 'PENDING_CONFIRMATION' ||
          rf.status === 'RECONCILIATION_REQUIRED'
        ) {
          pendingReconRefundCount += 1;
        }
      }

      const openIssueCount = await em
        .getRepository(ReconciliationIssueEntity)
        .count({ where: { tenantId, status: 'OPEN' } });

      return {
        tenantId,
        currency: 'VND',
        cashBalances: {
          totalCashBalance: totalCashVnd,
          activeAccountCount: cashAccounts.length,
        },
        cashbook: {
          totalReceipts: totalReceiptsVnd,
          totalExpenses: totalExpensesVnd,
          netCashFlow: totalReceiptsVnd - totalExpensesVnd,
        },
        receivables: {
          totalOpenCustomerDebt: openArVnd,
          openReceivableCount: openArCount,
        },
        payables: {
          totalOpenSupplierPayable: openApVnd,
          openPayableCount: openApCount,
        },
        cod: {
          pendingCodReceivableAmount: pendingCodVnd,
          reconciledCodNetAmount: reconciledCodNetVnd,
          codDiscrepancyCount,
        },
        refunds: {
          completedRefundAmount: completedRefundVnd,
          pendingReconciliationRefundCount: pendingReconRefundCount,
        },
        reconciliation: {
          openIssueCount,
        },
      };
    });
  }

  @OnEvent(SALES_SHIFT_CLOSED.type)
  async onSalesShiftClosed(
    envelope: EventEnvelope<SalesShiftEventPayload>,
  ): Promise<void> {
    const { tenantId, payload } = envelope;
    if (!tenantId || !payload?.shiftId || !payload?.branchId) {
      return;
    }
    const openingVnd = parseVnd(payload.openingCash ?? 0, {
      allowZero: true,
      field: 'openingCash',
    });
    const expectedVnd = parseVnd(
      payload.expectedCash ?? payload.openingCash ?? 0,
      {
        allowZero: true,
        field: 'expectedCash',
      },
    );
    const salesVnd = expectedVnd >= openingVnd ? expectedVnd - openingVnd : 0;
    const actualVnd = parseVnd(
      payload.actualCash ?? payload.expectedCash ?? 0,
      {
        allowZero: true,
        field: 'actualCash',
      },
    );

    await this.reconcileShiftCash(
      payload.staffId ?? 'event:sales.shift.closed',
      {
        shiftId: payload.shiftId,
        shiftCode: payload.code,
        branchId: payload.branchId,
        staffId: payload.staffId,
        openingCash: openingVnd,
        confirmedCashSales: salesVnd,
        confirmedCashRefunds: 0,
        actualCountedCash: actualVnd,
      },
      tenantId,
    );
  }

  private resolveAdjustmentAccounts(
    targetType: 'RECEIVABLE' | 'PAYABLE' | 'CASH_ACCOUNT',
    direction: 'DECREASE' | 'INCREASE',
  ): { debitGl: string; creditGl: string } {
    if (targetType === 'RECEIVABLE') {
      return direction === 'DECREASE'
        ? {
            debitGl: GL_ACCOUNT_CODES.OPERATING_EXPENSE,
            creditGl: GL_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
          }
        : {
            debitGl: GL_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
            creditGl: GL_ACCOUNT_CODES.OTHER_INCOME,
          };
    }
    if (targetType === 'PAYABLE') {
      return direction === 'DECREASE'
        ? {
            debitGl: GL_ACCOUNT_CODES.ACCOUNTS_PAYABLE,
            creditGl: GL_ACCOUNT_CODES.INVENTORY_PURCHASE_CLEARING,
          }
        : {
            debitGl: GL_ACCOUNT_CODES.INVENTORY_PURCHASE_CLEARING,
            creditGl: GL_ACCOUNT_CODES.ACCOUNTS_PAYABLE,
          };
    }
    return direction === 'DECREASE'
      ? {
          debitGl: GL_ACCOUNT_CODES.CASH_VARIANCE,
          creditGl: GL_ACCOUNT_CODES.CASH_ON_HAND,
        }
      : {
          debitGl: GL_ACCOUNT_CODES.CASH_ON_HAND,
          creditGl: GL_ACCOUNT_CODES.OTHER_INCOME,
        };
  }

  private async ensureIssueTrackedByRunInTx(
    em: EntityManager,
    tenantId: string,
    runId: string,
    params: {
      sourceType: string;
      sourceId: string;
      issueType: string;
      expectedAmount: number;
      actualAmount: number;
      differenceAmount: number;
      description: string;
    },
  ): Promise<void> {
    const repo = em.getRepository(ReconciliationIssueEntity);
    const existing = await repo.findOne({
      where: {
        tenantId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        status: 'OPEN',
      },
    });
    if (existing) {
      existing.runId = runId;
      await repo.save(existing);
      return;
    }

    await repo.save(
      repo.create({
        id: randomUUID(),
        tenantId,
        runId,
        issueType: params.issueType,
        severity: 'HIGH',
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        expectedAmount: params.expectedAmount,
        actualAmount: params.actualAmount,
        differenceAmount: params.differenceAmount,
        status: 'OPEN',
        description: params.description,
        resolutionNote: null,
        resolvedBy: null,
        resolvedAt: null,
      }),
    );
  }
}
