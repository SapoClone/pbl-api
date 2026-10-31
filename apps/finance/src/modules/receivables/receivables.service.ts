import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  FINANCE_RECEIVABLE_CREATED,
  FINANCE_RECEIVABLE_PAYMENT_APPLIED,
  FinanceReceivableEventPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  calculateDocumentAllocations,
  evaluateCreditAuthorization,
  FinanceDomainError,
  FinanceDomainErrorCode,
  GL_ACCOUNT_CODES,
  parseVnd,
} from '../../domain/finance-domain';
import {
  getSchemaPrefix,
  nextFinanceDocumentCode,
} from '../../infrastructure/persistence/finance-code.generator';
import {
  CashAccountEntity,
  CustomerCreditProfileEntity,
  CustomerDebtLedgerEntity,
  CustomerReceivableEntity,
} from '../../infrastructure/persistence/finance.entities';
import { applyBranchScope, BranchScope } from '../../presentation/branch-scope';
import { CashAccountsService } from '../cash-accounts/cash-accounts.service';
import { CashbookService } from '../cashbook/cashbook.service';
import { CreditAuthorizationService } from '../credit-authorization/credit-authorization.service';
import { FinancialJournalService } from '../financial-journal/financial-journal.service';
import {
  ListReceivablesQueryDto,
  RecognizeReceivableDto,
  RecordReceivablePaymentDto,
} from './receivables.dto';

@Injectable()
export class ReceivablesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly journalService: FinancialJournalService,
    private readonly cashAccountsService: CashAccountsService,
    private readonly cashbookService: CashbookService,
    private readonly creditAuthService: CreditAuthorizationService,
    private readonly outbox: EventOutbox,
  ) {}

  private get schemaPrefix(): string {
    return getSchemaPrefix(this.dataSource);
  }

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

  async recognizeReceivable(
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: RecognizeReceivableDto,
    tenantId = TenantContext.require(),
  ) {
    const amountVnd = parseVnd(dto.amount, {
      allowZero: false,
      field: 'amount',
    });
    const sourceType = (dto.sourceType ?? 'SALES_ORDER').trim().toUpperCase();
    const sourceId = (
      dto.sourceId ??
      dto.orderId ??
      `manual:${dto.customerId}:${amountVnd}`
    ).trim();
    const idempotencyKey = (
      idempotencyKeyHeader ??
      dto.idempotencyKey ??
      `ar:${sourceType}:${sourceId}`
    )
      .trim()
      .toLowerCase();

    return this.runInTenantTx(tenantId, async (em) => {
      const recRepo = em.getRepository(CustomerReceivableEntity);
      const profileRepo = em.getRepository(CustomerCreditProfileEntity);
      const ledgerRepo = em.getRepository(CustomerDebtLedgerEntity);

      // Lock customer credit profile first so concurrent recognitions serialize
      const profile = await this.creditAuthService.lockOrCreateProfileInTx(
        em,
        tenantId,
        dto.customerId,
      );

      // Check existing by source or idempotencyKey (Test E)
      const existing = await recRepo.findOne({
        where: [
          { tenantId, sourceType, sourceId },
          { tenantId, idempotencyKey },
        ],
      });
      if (existing) {
        if (
          existing.customerId !== dto.customerId ||
          existing.originalAmount !== amountVnd
        ) {
          throw new FinanceDomainError(
            FinanceDomainErrorCode.IDEMPOTENCY_CONFLICT,
            `Receivable idempotency key "${idempotencyKey}" or source "${sourceType}:${sourceId}" was already used with different parameters`,
            409,
          );
        }
        return {
          ...existing,
          customerTotalDebtAfter: profile.postedDebt,
          replayed: true,
        };
      }

      // Enforce credit limit before recognizing new debt
      evaluateCreditAuthorization({
        creditLimit: profile.creditLimit,
        postedDebt: profile.postedDebt,
        heldCredit: profile.heldCredit,
        requestedAmount: amountVnd,
        overrideApprovedBy: dto.overrideApprovedBy,
        overrideReason: dto.note,
      });

      const postedBeforeVnd = parseVnd(profile.postedDebt, {
        allowZero: true,
        field: 'postedDebt',
      });
      const postedAfterVnd = postedBeforeVnd + amountVnd;

      const postedJournal = await this.journalService.postJournalInTx(
        em,
        tenantId,
        {
          journalType: 'CREDIT_SALE_RECEIVABLE',
          sourceType,
          sourceId,
          idempotencyKey: `ar-jnl:${idempotencyKey}`,
          branchId: dto.branchId ?? null,
          description:
            dto.note ??
            `Customer receivable recognized for ${sourceType}:${sourceId}`,
          postedBy: actorId,
          lines: [
            {
              accountCode: GL_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
              debitAmount: amountVnd,
              branchId: dto.branchId ?? null,
              partyType: 'CUSTOMER',
              partyId: dto.customerId,
              memo: `Receivable for ${sourceType}:${sourceId}`,
            },
            {
              accountCode: GL_ACCOUNT_CODES.SALES_REVENUE_CLEARING,
              creditAmount: amountVnd,
              branchId: dto.branchId ?? null,
              partyType: 'CUSTOMER',
              partyId: dto.customerId,
              memo: `Sales clearing for ${sourceType}:${sourceId}`,
            },
          ],
        },
      );

      const code = await nextFinanceDocumentCode(em, tenantId, 'AR');
      const now = new Date();
      const receivable = recRepo.create({
        id: randomUUID(),
        tenantId,
        code,
        customerId: dto.customerId,
        orderId: dto.orderId ?? null,
        branchId: dto.branchId ?? null,
        creditAuthorizationId: null,
        originalAmount: amountVnd,
        paidAmount: 0,
        adjustedAmount: 0,
        outstandingAmount: amountVnd,
        currency: 'VND',
        status: 'OPEN',
        dueDate: new Date(now.getTime() + 30 * 86400 * 1000),
        sourceType,
        sourceId,
        journalId: postedJournal.journal.id,
        idempotencyKey,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      await recRepo.save(receivable);

      const ledgerEntry = ledgerRepo.create({
        id: randomUUID(),
        tenantId,
        customerId: dto.customerId,
        receivableId: receivable.id,
        entryType: 'DEBT_RECOGNIZED',
        amountDelta: amountVnd,
        balanceBefore: postedBeforeVnd,
        balanceAfter: postedAfterVnd,
        paymentMethod: 'CREDIT',
        cashbookEntryId: null,
        journalId: postedJournal.journal.id,
        referenceType: sourceType,
        referenceId: sourceId,
        idempotencyKey: `ar-ldg:${idempotencyKey}`,
        note: dto.note ?? null,
        actorId,
        occurredAt: now,
      });
      await ledgerRepo.save(ledgerEntry);

      profile.postedDebt = postedAfterVnd;
      profile.version += 1;
      profile.updatedAt = now;
      await profileRepo.save(profile);

      await this.outbox.add(
        em,
        FINANCE_RECEIVABLE_CREATED,
        {
          receivableId: receivable.id,
          code: receivable.code,
          customerId: receivable.customerId,
          orderId: receivable.orderId,
          branchId: receivable.branchId,
          originalAmount: receivable.originalAmount,
          paidAmount: receivable.paidAmount,
          outstandingAmount: receivable.outstandingAmount,
          customerTotalDebtAfter: profile.postedDebt,
          status: receivable.status,
          journalId: receivable.journalId,
          occurredAt: now.toISOString(),
        } satisfies FinanceReceivableEventPayload,
        { tenantId },
      );

      return {
        ...receivable,
        customerTotalDebtAfter: profile.postedDebt,
        replayed: false,
      };
    });
  }

  /**
   * Records a debt payment against a single receivable or across multiple customer receivables.
   * Locks customer credit profile and open receivables FOR UPDATE in deterministic order (Test F).
   * Never records debt collection as new sales revenue!
   */
  async recordReceivablePayment(
    targetReceivableId: string | null,
    targetCustomerId: string | null,
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: RecordReceivablePaymentDto,
    tenantId = TenantContext.require(),
  ) {
    const cleanKey = (
      idempotencyKeyHeader ??
      dto.idempotencyKey ??
      `ar-pay:${randomUUID()}`
    )
      .trim()
      .toLowerCase();

    return this.runInTenantTx(tenantId, async (em) => {
      const recRepo = em.getRepository(CustomerReceivableEntity);
      const profileRepo = em.getRepository(CustomerCreditProfileEntity);
      const ledgerRepo = em.getRepository(CustomerDebtLedgerEntity);

      // Check idempotency in customer_debt_ledger
      const existingLedger = await ledgerRepo.findOne({
        where: [
          { tenantId, idempotencyKey: cleanKey },
          { tenantId, idempotencyKey: `${cleanKey}:1` },
        ],
      });
      if (existingLedger) {
        const rec = await recRepo.findOne({
          where: { id: existingLedger.receivableId, tenantId },
        });
        const profile = await this.creditAuthService.lockOrCreateProfileInTx(
          em,
          tenantId,
          existingLedger.customerId,
        );
        return {
          receivable: rec,
          customerTotalDebtAfter: profile.postedDebt,
          prepaymentBalanceAfter: profile.prepaymentBalance,
          journalId: existingLedger.journalId,
          cashbookEntryId: existingLedger.cashbookEntryId,
          replayed: true,
        };
      }

      let customerId = targetCustomerId;
      if (targetReceivableId && !customerId) {
        const target = await recRepo.findOne({
          where: { id: targetReceivableId, tenantId },
        });
        if (!target) {
          throw new FinanceDomainError(
            FinanceDomainErrorCode.RECEIVABLE_NOT_FOUND,
            `Receivable ${targetReceivableId} not found`,
            404,
          );
        }
        customerId = target.customerId;
      }

      if (!customerId) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.VALIDATION_ERROR,
          'customerId or receivableId is required',
          422,
        );
      }

      // Lock customer credit profile FOR UPDATE first
      const profile = await this.creditAuthService.lockOrCreateProfileInTx(
        em,
        tenantId,
        customerId,
      );

      // Lock open receivables for this customer in deterministic created_at ASC, id ASC order
      const openDocs = await recRepo.find({
        where: targetReceivableId
          ? { id: targetReceivableId, tenantId, customerId }
          : {
              tenantId,
              customerId,
              status: In(['OPEN', 'PARTIALLY_PAID']),
            },
        order: { createdAt: 'ASC', id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });

      if (openDocs.length === 0) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.RECEIVABLE_NOT_FOUND,
          'No open customer receivables found to allocate payment against',
          404,
        );
      }

      const explicitAllocs = dto.allocations?.map((a) => ({
        documentId: a.receivableId,
        amount: a.amount,
      }));

      const allocationResult = calculateDocumentAllocations(
        dto.amount,
        openDocs,
        explicitAllocs,
        {
          overpaymentPolicy: dto.overpaymentPolicy ?? 'REJECT',
          kind: 'RECEIVABLE',
        },
      );

      const paymentMethod = dto.paymentMethod ?? 'CASH';
      let cashAccount: CashAccountEntity;
      if (dto.cashAccountId) {
        const found = await em
          .getRepository(CashAccountEntity)
          .findOne({ where: { id: dto.cashAccountId, tenantId } });
        if (!found) {
          throw new FinanceDomainError(
            FinanceDomainErrorCode.CASH_ACCOUNT_NOT_FOUND,
            `Cash account ${dto.cashAccountId} not found`,
            404,
          );
        }
        cashAccount = found;
      } else {
        cashAccount =
          await this.cashAccountsService.ensureDefaultCashAccountInTx(
            em,
            tenantId,
            dto.branchId ?? openDocs[0].branchId ?? null,
            paymentMethod === 'CASH' ? 'CASH_DRAWER' : 'BANK',
          );
      }

      const overpayVnd = parseVnd(allocationResult.overpaymentAmount, {
        allowZero: true,
        field: 'overpaymentAmount',
      });

      // Build balanced journal lines:
      // Debit Cash/Bank (paymentAmount)
      // Credit Accounts Receivable (totalAllocated)
      // Credit Customer Prepayment (overpaymentAmount if > 0)
      const journalLines: Array<{
        accountCode: string;
        debitAmount?: number;
        creditAmount?: number;
        branchId?: string | null;
        partyType?: 'CUSTOMER' | 'SUPPLIER' | 'CARRIER' | null;
        partyId?: string | null;
        memo?: string | null;
      }> = [
        {
          accountCode: cashAccount.glAccountCode,
          debitAmount: allocationResult.paymentAmount,
          branchId: dto.branchId ?? openDocs[0].branchId ?? null,
          partyType: 'CUSTOMER' as const,
          partyId: customerId,
          memo: dto.note ?? `Customer debt collection (${paymentMethod})`,
        },
        {
          accountCode: GL_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
          creditAmount: allocationResult.totalAllocated,
          branchId: dto.branchId ?? openDocs[0].branchId ?? null,
          partyType: 'CUSTOMER' as const,
          partyId: customerId,
          memo: `Allocated to receivable(s): ${allocationResult.allocations.map((a) => a.code).join(', ')}`,
        },
      ];
      if (overpayVnd > 0) {
        journalLines.push({
          accountCode: GL_ACCOUNT_CODES.CUSTOMER_PREPAYMENT,
          creditAmount: allocationResult.overpaymentAmount,
          branchId: dto.branchId ?? openDocs[0].branchId ?? null,
          partyType: 'CUSTOMER' as const,
          partyId: customerId,
          memo: 'Customer overpayment credit',
        });
      }

      const postedJournal = await this.journalService.postJournalInTx(
        em,
        tenantId,
        {
          journalType: 'RECEIVABLE_COLLECTION',
          sourceType: 'RECEIVABLE_PAYMENT',
          sourceId: cleanKey,
          idempotencyKey: `ar-pay-jnl:${cleanKey}`,
          branchId: dto.branchId ?? openDocs[0].branchId ?? null,
          description:
            dto.note ??
            `Customer debt collection for ${allocationResult.allocations.map((a) => a.code).join(', ')}`,
          postedBy: actorId,
          lines: journalLines,
        },
      );

      // Create & post Cashbook Receipt Voucher linked to the same journal (so cash account balance updates once)
      const cashbookEntry =
        await this.cashbookService.createAndOptionallyPostVoucherInTx(
          em,
          tenantId,
          {
            actorId,
            direction: 'RECEIPT',
            cashAccountId: cashAccount.id,
            categoryCode: 'DEBT_COLLECTION',
            amount: allocationResult.paymentAmount,
            branchId: dto.branchId ?? openDocs[0].branchId ?? null,
            voucherType: 'DEBT_COLLECTION',
            sourceType: 'RECEIVABLE_PAYMENT',
            sourceId: cleanKey,
            partyType: 'CUSTOMER',
            partyId: customerId,
            description:
              dto.note ??
              `Debt collection for ${allocationResult.allocations.map((a) => a.code).join(', ')}`,
            autoPost: true,
            idempotencyKey: `cb-ar-pay:${cleanKey}`,
            skipJournalIfLinked: postedJournal.journal.id,
          },
        );

      let runningDebtVnd = parseVnd(profile.postedDebt, {
        allowZero: true,
        field: 'postedDebt',
      });
      const docMap = new Map(openDocs.map((d) => [d.id, d]));
      const now = new Date();
      const updatedReceivables: CustomerReceivableEntity[] = [];

      for (let i = 0; i < allocationResult.allocations.length; i += 1) {
        const alloc = allocationResult.allocations[i];
        const doc = docMap.get(alloc.documentId)!;
        const allocVnd = parseVnd(alloc.allocatedAmount, {
          allowZero: false,
          field: 'allocatedAmount',
        });
        const debtBeforeVnd = runningDebtVnd;
        const debtAfterVnd =
          debtBeforeVnd >= allocVnd ? debtBeforeVnd - allocVnd : 0;
        runningDebtVnd = debtAfterVnd;

        doc.paidAmount = alloc.paidAmountAfter;
        doc.outstandingAmount = alloc.outstandingAfter;
        doc.status = alloc.statusAfter;
        doc.version += 1;
        doc.updatedAt = now;
        await recRepo.save(doc);
        updatedReceivables.push(doc);

        const ledgerEntry = ledgerRepo.create({
          id: randomUUID(),
          tenantId,
          customerId,
          receivableId: doc.id,
          entryType: 'PAYMENT_APPLIED',
          amountDelta: -alloc.allocatedAmount,
          balanceBefore: debtBeforeVnd,
          balanceAfter: debtAfterVnd,
          paymentMethod,
          cashbookEntryId: cashbookEntry.id,
          journalId: postedJournal.journal.id,
          referenceType: 'RECEIVABLE_PAYMENT',
          referenceId: cleanKey,
          idempotencyKey:
            allocationResult.allocations.length === 1
              ? cleanKey
              : `${cleanKey}:${i + 1}`,
          note: dto.note ?? `Payment applied to ${doc.code}`,
          actorId,
          occurredAt: now,
        });
        await ledgerRepo.save(ledgerEntry);
      }

      profile.postedDebt = runningDebtVnd;
      if (overpayVnd > 0) {
        const prevPrep = parseVnd(profile.prepaymentBalance, {
          allowZero: true,
          field: 'prepaymentBalance',
        });
        profile.prepaymentBalance = prevPrep + overpayVnd;
      }
      profile.version += 1;
      profile.updatedAt = now;
      await profileRepo.save(profile);

      const primaryRec = updatedReceivables[0];
      await this.outbox.add(
        em,
        FINANCE_RECEIVABLE_PAYMENT_APPLIED,
        {
          receivableId: primaryRec.id,
          code: primaryRec.code,
          customerId,
          orderId: primaryRec.orderId,
          branchId: primaryRec.branchId,
          originalAmount: primaryRec.originalAmount,
          paidAmount: primaryRec.paidAmount,
          outstandingAmount: primaryRec.outstandingAmount,
          customerTotalDebtAfter: profile.postedDebt,
          status: primaryRec.status,
          journalId: postedJournal.journal.id,
          occurredAt: now.toISOString(),
        } satisfies FinanceReceivableEventPayload,
        { tenantId },
      );

      return {
        receivable: primaryRec,
        updatedReceivables,
        allocations: allocationResult.allocations,
        totalAllocated: allocationResult.totalAllocated,
        overpaymentAmount: allocationResult.overpaymentAmount,
        customerTotalDebtAfter: profile.postedDebt,
        prepaymentBalanceAfter: profile.prepaymentBalance,
        journalId: postedJournal.journal.id,
        cashbookEntryId: cashbookEntry.id,
        replayed: false,
      };
    });
  }

  async getReceivableById(
    id: string,
    tenantId = TenantContext.require(),
  ): Promise<CustomerReceivableEntity> {
    return this.runInTenantTx(tenantId, async (em) => {
      const rec = await em
        .getRepository(CustomerReceivableEntity)
        .findOne({ where: { id, tenantId } });
      if (!rec) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.RECEIVABLE_NOT_FOUND,
          `Receivable ${id} not found`,
          404,
        );
      }
      return rec;
    });
  }

  async listReceivables(
    query: ListReceivablesQueryDto,
    tenantId = TenantContext.require(),
    scope: BranchScope = null,
  ) {
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    return this.runInTenantTx(tenantId, async (em) => {
      const where: Record<string, unknown> = { tenantId };
      if (query.customerId) {
        where.customerId = query.customerId;
      }
      if (query.orderId) {
        where.orderId = query.orderId;
      }
      if (query.status) {
        where.status = query.status;
      }
      applyBranchScope(where, scope);

      const [items, total] = await em
        .getRepository(CustomerReceivableEntity)
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

  async getCustomerDebtSummary(
    customerId: string,
    tenantId = TenantContext.require(),
  ) {
    return this.runInTenantTx(tenantId, async (em) => {
      const profile = await this.creditAuthService.lockOrCreateProfileInTx(
        em,
        tenantId,
        customerId,
      );
      const receivables = await em
        .getRepository(CustomerReceivableEntity)
        .find({
          where: { tenantId, customerId },
          order: { createdAt: 'DESC' },
          take: 50,
        });
      const ledger = await em.getRepository(CustomerDebtLedgerEntity).find({
        where: { tenantId, customerId },
        order: { occurredAt: 'DESC', id: 'DESC' },
        take: 50,
      });

      const limitVnd = parseVnd(profile.creditLimit, {
        allowZero: true,
        field: 'creditLimit',
      });
      const postedVnd = parseVnd(profile.postedDebt, {
        allowZero: true,
        field: 'postedDebt',
      });
      const heldVnd = parseVnd(profile.heldCredit, {
        allowZero: true,
        field: 'heldCredit',
      });
      const availVnd =
        limitVnd > postedVnd + heldVnd ? limitVnd - postedVnd - heldVnd : 0;

      return {
        customerId,
        tenantId,
        creditLimit: profile.creditLimit,
        postedDebt: profile.postedDebt,
        heldCredit: profile.heldCredit,
        availableCredit: availVnd,
        prepaymentBalance: profile.prepaymentBalance,
        openReceivablesCount: receivables.filter(
          (r) => r.status === 'OPEN' || r.status === 'PARTIALLY_PAID',
        ).length,
        receivables,
        ledger,
      };
    });
  }
}
