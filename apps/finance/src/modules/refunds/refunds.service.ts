import { Injectable } from '@nestjs/common';
import { EventEnvelope, TenantContext } from '@pbl/common';
import {
  FINANCE_REFUND_COMPLETED,
  FINANCE_REFUND_RECONCILIATION_REQUIRED,
  FinanceRefundEventPayload,
  SALES_REFUND_REQUESTED,
  SalesRefundRequestedPayload,
} from '@pbl/contracts';
import { EventOutbox, OnEvent } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  computePayloadHash,
  FinanceDomainError,
  FinanceDomainErrorCode,
  formatMoneyCents,
  GL_ACCOUNT_CODES,
  parseMoneyCents,
  validateRefundAllocation,
} from '../../domain/finance-domain';
import { nextFinanceDocumentCode } from '../../infrastructure/persistence/finance-code.generator';
import {
  CashAccountEntity,
  PaymentSettlementEntity,
  ReconciliationIssueEntity,
  RefundOperationEntity,
} from '../../infrastructure/persistence/finance.entities';
import { CashAccountsService } from '../cash-accounts/cash-accounts.service';
import { CashbookService } from '../cashbook/cashbook.service';
import { FinancialJournalService } from '../financial-journal/financial-journal.service';
import {
  ConfirmRefundOutcomeDto,
  CreateRefundDto,
  ExecuteRefundDto,
  ListRefundsQueryDto,
} from './refunds.dto';

@Injectable()
export class RefundsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly journalService: FinancialJournalService,
    private readonly cashAccountsService: CashAccountsService,
    private readonly cashbookService: CashbookService,
    private readonly outbox: EventOutbox,
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

  async createRefund(
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: CreateRefundDto,
    tenantId = TenantContext.require(),
  ): Promise<{ refund: RefundOperationEntity; replayed: boolean }> {
    return this.runInTenantTx(tenantId, async (em) =>
      this.createRefundInTx(em, tenantId, actorId, idempotencyKeyHeader, dto),
    );
  }

  async createRefundInTx(
    em: EntityManager,
    tenantId: string,
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: CreateRefundDto,
  ): Promise<{ refund: RefundOperationEntity; replayed: boolean }> {
    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `refund:${tenantId}:${dto.orderId}`,
    ]);

    const reqCents = parseMoneyCents(dto.amount, {
      allowZero: false,
      field: 'amount',
    });
    const reqStr = formatMoneyCents(reqCents);
    const cleanKey = (
      idempotencyKeyHeader ??
      dto.idempotencyKey ??
      (dto.salesRefundRequestId
        ? `rf:srr:${dto.salesRefundRequestId}`
        : `rf:${dto.orderId}:${dto.returnId ?? randomUUID()}`)
    )
      .trim()
      .toLowerCase();

    const reqHash = computePayloadHash({
      orderId: dto.orderId,
      returnId: dto.returnId ?? null,
      method: dto.method,
      amount: reqStr,
    });

    const refundRepo = em.getRepository(RefundOperationEntity);
    const existing = await refundRepo.findOne({
      where: [
        { tenantId, idempotencyKey: cleanKey },
        ...(dto.salesRefundRequestId
          ? [{ tenantId, salesRefundRequestId: dto.salesRefundRequestId }]
          : []),
      ],
    });
    if (existing) {
      if (existing.requestHash && existing.requestHash !== reqHash) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.IDEMPOTENCY_CONFLICT,
          `Refund idempotency key "${cleanKey}" was already used with a different payload`,
          409,
        );
      }
      return { refund: existing, replayed: true };
    }

    const settlements = await this.lockOrderSettlementsInTx(
      em,
      tenantId,
      dto.orderId,
      dto.settlementId,
    );

    const totalPaidCents = settlements.reduce(
      (sum, s) =>
        s.settlementStatus === 'SETTLED'
          ? sum +
            parseMoneyCents(s.settledAmount, {
              allowZero: true,
              field: 'settledAmount',
            })
          : sum,
      0n,
    );

    if (totalPaidCents <= 0n) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.REFUND_NOT_ELIGIBLE,
        `Order ${dto.orderId} has no settled payments eligible for refund`,
        409,
      );
    }

    const existingRefunds = await refundRepo
      .createQueryBuilder('r')
      .setLock('pessimistic_write')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.order_id = :orderId', { orderId: dto.orderId })
      .getMany();

    const activeRefundCents = existingRefunds.reduce(
      (sum, r) =>
        r.status !== 'FAILED' && r.status !== 'REJECTED'
          ? sum +
            parseMoneyCents(r.amount, { allowZero: true, field: 'amount' })
          : sum,
      0n,
    );

    validateRefundAllocation({
      originalPaidAmount: formatMoneyCents(totalPaidCents),
      alreadyRefundedAmount: formatMoneyCents(activeRefundCents),
      requestedRefundAmount: reqStr,
    });

    const code = await nextFinanceDocumentCode(em, tenantId, 'RFD');
    const refundId = randomUUID();
    const targetSettlement = settlements[0];
    const now = new Date();
    const initialStatus =
      dto.autoApprove || dto.autoExecute ? 'APPROVED' : 'REQUESTED';

    let refund = refundRepo.create({
      id: refundId,
      tenantId,
      code,
      salesRefundRequestId: dto.salesRefundRequestId ?? null,
      returnId: dto.returnId ?? null,
      orderId: dto.orderId,
      settlementId: targetSettlement?.id ?? dto.settlementId ?? null,
      branchId: dto.branchId ?? targetSettlement?.branchId ?? null,
      shiftId: dto.shiftId ?? targetSettlement?.shiftId ?? null,
      cashAccountId: dto.cashAccountId ?? null,
      amount: reqStr,
      currency: 'VND',
      method: dto.method,
      status: initialStatus,
      provider:
        dto.provider ??
        (dto.method === 'CASH'
          ? 'MANUAL_CASH'
          : (targetSettlement?.provider ?? 'GATEWAY')),
      providerIdempotencyKey: `rf-prov:${tenantId}:${code}`,
      externalRefundRef: null,
      cashbookEntryId: null,
      journalId: null,
      idempotencyKey: cleanKey,
      requestHash: reqHash,
      failureReason: null,
      requestedBy: actorId,
      approvedBy: initialStatus === 'APPROVED' ? actorId : null,
      executedBy: null,
      approvedAt: initialStatus === 'APPROVED' ? now : null,
      executedAt: null,
      completedAt: null,
      version: 1,
    });

    refund = await refundRepo.save(refund);

    if (dto.autoExecute) {
      refund = await this.executeRefundInTx(em, tenantId, actorId, refund.id, {
        cashAccountId: dto.cashAccountId,
      });
    }

    return { refund, replayed: false };
  }

  async approveRefund(
    refundId: string,
    actorId: string,
    tenantId = TenantContext.require(),
  ): Promise<RefundOperationEntity> {
    return this.runInTenantTx(tenantId, async (em) => {
      const repo = em.getRepository(RefundOperationEntity);
      const refund = await repo.findOne({
        where: { id: refundId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!refund) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.REFUND_NOT_FOUND,
          `Refund operation ${refundId} not found`,
          404,
        );
      }
      if (refund.status === 'APPROVED') {
        return refund;
      }
      if (refund.status !== 'REQUESTED') {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.REFUND_INVALID_STATE,
          `Cannot approve refund in state ${refund.status}`,
          409,
        );
      }
      refund.status = 'APPROVED';
      refund.approvedBy = actorId;
      refund.approvedAt = new Date();
      refund.version += 1;
      return repo.save(refund);
    });
  }

  async executeRefund(
    refundId: string,
    actorId: string,
    dto: ExecuteRefundDto,
    tenantId = TenantContext.require(),
  ): Promise<RefundOperationEntity> {
    return this.runInTenantTx(tenantId, async (em) =>
      this.executeRefundInTx(em, tenantId, actorId, refundId, dto),
    );
  }

  async executeRefundInTx(
    em: EntityManager,
    tenantId: string,
    actorId: string,
    refundId: string,
    dto: ExecuteRefundDto,
  ): Promise<RefundOperationEntity> {
    const repo = em.getRepository(RefundOperationEntity);
    const refund = await repo.findOne({
      where: { id: refundId, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!refund) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.REFUND_NOT_FOUND,
        `Refund operation ${refundId} not found`,
        404,
      );
    }

    if (refund.status === 'COMPLETED') {
      return refund;
    }

    if (refund.status === 'FAILED' || refund.status === 'REJECTED') {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.REFUND_INVALID_STATE,
        `Cannot execute refund in terminal state ${refund.status}`,
        409,
      );
    }

    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `refund:${tenantId}:${refund.orderId}`,
    ]);

    const now = new Date();
    if (refund.status === 'REQUESTED') {
      refund.approvedBy = actorId;
      refund.approvedAt = now;
    }
    refund.executedBy = actorId;
    refund.executedAt = now;

    if (dto.simulateProviderTimeout) {
      refund.status = dto.requireReconciliationOnTimeout
        ? 'RECONCILIATION_REQUIRED'
        : 'PENDING_CONFIRMATION';
      refund.failureReason =
        'External payment provider timed out; awaiting reconciliation confirmation';
      refund.version += 1;
      const savedTimeout = await repo.save(refund);

      await em.getRepository(ReconciliationIssueEntity).save(
        em.getRepository(ReconciliationIssueEntity).create({
          id: randomUUID(),
          tenantId,
          runId: null,
          issueType: 'REFUND_PROVIDER_TIMEOUT',
          severity: 'HIGH',
          sourceType: 'REFUND_OPERATION',
          sourceId: savedTimeout.id,
          expectedAmount: savedTimeout.amount,
          actualAmount: '0.00',
          differenceAmount: savedTimeout.amount,
          status: 'OPEN',
          description: `Refund ${savedTimeout.code} timed out with provider ${savedTimeout.provider} (providerIdempotencyKey=${savedTimeout.providerIdempotencyKey})`,
          resolutionNote: null,
          resolvedBy: null,
          resolvedAt: null,
        }),
      );

      await this.outbox.add(
        em,
        FINANCE_REFUND_RECONCILIATION_REQUIRED,
        {
          refundId: savedTimeout.id,
          code: savedTimeout.code,
          salesRefundRequestId: savedTimeout.salesRefundRequestId,
          returnId: savedTimeout.returnId,
          orderId: savedTimeout.orderId,
          amount: savedTimeout.amount,
          method: savedTimeout.method,
          status: savedTimeout.status,
          journalId: null,
          reason: savedTimeout.failureReason,
          occurredAt: now.toISOString(),
        } satisfies FinanceRefundEventPayload,
        { tenantId },
      );

      return savedTimeout;
    }

    return this.finalizeRefundCompletionInTx(em, tenantId, actorId, refund, {
      cashAccountId: dto.cashAccountId,
      externalRefundRef: dto.externalRefundRef,
    });
  }

  async confirmRefundOutcome(
    refundId: string,
    actorId: string,
    dto: ConfirmRefundOutcomeDto,
    tenantId = TenantContext.require(),
  ): Promise<RefundOperationEntity> {
    return this.runInTenantTx(tenantId, async (em) => {
      const repo = em.getRepository(RefundOperationEntity);
      const refund = await repo.findOne({
        where: { id: refundId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!refund) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.REFUND_NOT_FOUND,
          `Refund operation ${refundId} not found`,
          404,
        );
      }

      if (refund.status === 'COMPLETED' && dto.outcome === 'COMPLETED') {
        return refund;
      }

      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `refund:${tenantId}:${refund.orderId}`,
      ]);

      const now = new Date();
      if (dto.outcome === 'FAILED') {
        refund.status = 'FAILED';
        refund.failureReason =
          dto.failureReason ?? 'Confirmed failed by payment provider';
        refund.version += 1;
        const savedFailed = await repo.save(refund);

        await em.getRepository(ReconciliationIssueEntity).update(
          {
            tenantId,
            sourceType: 'REFUND_OPERATION',
            sourceId: savedFailed.id,
            status: 'OPEN',
          },
          {
            status: 'RESOLVED',
            resolutionNote: `Provider confirmed refund failed: ${refund.failureReason}`,
            resolvedBy: actorId,
            resolvedAt: now,
          },
        );
        return savedFailed;
      }

      if (dto.outcome === 'RECONCILIATION_REQUIRED') {
        refund.status = 'RECONCILIATION_REQUIRED';
        refund.failureReason =
          dto.failureReason ?? 'Escalated to manual reconciliation';
        refund.version += 1;
        return repo.save(refund);
      }

      return this.finalizeRefundCompletionInTx(em, tenantId, actorId, refund, {
        cashAccountId: dto.cashAccountId,
        externalRefundRef: dto.externalRefundRef,
      });
    });
  }

  async getRefundById(
    id: string,
    tenantId = TenantContext.require(),
  ): Promise<RefundOperationEntity> {
    return this.runInTenantTx(tenantId, async (em) => {
      const refund = await em
        .getRepository(RefundOperationEntity)
        .findOne({ where: { id, tenantId } });
      if (!refund) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.REFUND_NOT_FOUND,
          `Refund operation ${id} not found`,
          404,
        );
      }
      return refund;
    });
  }

  async listRefunds(
    query: ListRefundsQueryDto,
    tenantId = TenantContext.require(),
  ) {
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    return this.runInTenantTx(tenantId, async (em) => {
      const where: Record<string, unknown> = { tenantId };
      if (query.orderId) {
        where.orderId = query.orderId;
      }
      if (query.status) {
        where.status = query.status;
      }
      const [items, total] = await em
        .getRepository(RefundOperationEntity)
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

  @OnEvent(SALES_REFUND_REQUESTED.type)
  async onSalesRefundRequested(
    envelope: EventEnvelope<SalesRefundRequestedPayload>,
  ): Promise<void> {
    const { tenantId, payload } = envelope;
    if (!tenantId || !payload?.orderId || !payload?.amount) {
      return;
    }
    const method = (payload.method ?? 'CASH').toUpperCase();
    await this.createRefund(
      'event:sales.refund.requested',
      `evt:rf:${payload.refundRequestId ?? payload.returnId ?? payload.orderId}`,
      {
        orderId: payload.orderId,
        salesRefundRequestId: payload.refundRequestId,
        returnId: payload.returnId,
        branchId: payload.branchId,
        method: ([
          'CASH',
          'BANK_TRANSFER',
          'CARD',
          'EWALLET',
          'CUSTOMER_CREDIT',
        ].includes(method)
          ? method
          : 'CASH') as
          | 'CASH'
          | 'BANK_TRANSFER'
          | 'CARD'
          | 'EWALLET'
          | 'CUSTOMER_CREDIT',
        amount: payload.amount,
        autoApprove: true,
        autoExecute: method === 'CASH' || method === 'CUSTOMER_CREDIT',
        idempotencyKey: `evt:rf:${payload.refundRequestId ?? payload.returnId ?? payload.orderId}`,
      },
      tenantId,
    );
  }

  private async finalizeRefundCompletionInTx(
    em: EntityManager,
    tenantId: string,
    actorId: string,
    refund: RefundOperationEntity,
    options: {
      cashAccountId?: string;
      externalRefundRef?: string;
    },
  ): Promise<RefundOperationEntity> {
    const settlements = await this.lockOrderSettlementsInTx(
      em,
      tenantId,
      refund.orderId,
      refund.settlementId ?? undefined,
    );

    const refundCents = parseMoneyCents(refund.amount, {
      allowZero: false,
      field: 'amount',
    });
    const totalPaidCents = settlements.reduce(
      (sum, s) =>
        sum +
        parseMoneyCents(s.settledAmount, {
          allowZero: true,
          field: 'settledAmount',
        }),
      0n,
    );
    const alreadySettledRefundCents = settlements.reduce(
      (sum, s) =>
        sum +
        parseMoneyCents(s.refundedAmount, {
          allowZero: true,
          field: 'refundedAmount',
        }),
      0n,
    );

    validateRefundAllocation({
      originalPaidAmount: formatMoneyCents(totalPaidCents),
      alreadyRefundedAmount: formatMoneyCents(alreadySettledRefundCents),
      requestedRefundAmount: refund.amount,
    });

    const stlRepo = em.getRepository(PaymentSettlementEntity);
    let remainingToApply = refundCents;
    for (const settlement of settlements) {
      if (remainingToApply <= 0n) {
        break;
      }
      const settled = parseMoneyCents(settlement.settledAmount, {
        allowZero: true,
        field: 'settledAmount',
      });
      const refunded = parseMoneyCents(settlement.refundedAmount, {
        allowZero: true,
        field: 'refundedAmount',
      });
      const available = settled - refunded;
      if (available <= 0n) {
        continue;
      }

      const delta =
        remainingToApply <= available ? remainingToApply : available;
      settlement.refundedAmount = formatMoneyCents(refunded + delta);
      settlement.version += 1;
      await stlRepo.save(settlement);
      remainingToApply -= delta;
    }

    const targetCashAccountId = options.cashAccountId ?? refund.cashAccountId;
    let cashAccount: CashAccountEntity | null = null;
    if (['CASH', 'BANK_TRANSFER', 'CARD', 'EWALLET'].includes(refund.method)) {
      if (targetCashAccountId) {
        cashAccount = await em.getRepository(CashAccountEntity).findOne({
          where: { id: targetCashAccountId, tenantId },
        });
      } else {
        cashAccount =
          await this.cashAccountsService.ensureDefaultCashAccountInTx(
            em,
            tenantId,
            refund.branchId ?? null,
            refund.method === 'CASH' ? 'CASH_DRAWER' : 'BANK',
          );
      }
    }

    const creditGl =
      cashAccount?.glAccountCode ??
      (refund.method === 'CUSTOMER_CREDIT'
        ? GL_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE
        : refund.method === 'CASH'
          ? GL_ACCOUNT_CODES.CASH_ON_HAND
          : GL_ACCOUNT_CODES.CASH_AT_BANK);

    const postedJournal = await this.journalService.postJournalInTx(
      em,
      tenantId,
      {
        journalType: 'REFUND',
        sourceType: 'REFUND_OPERATION',
        sourceId: refund.id,
        idempotencyKey: `rf-jnl:${refund.id}`,
        branchId: refund.branchId,
        description: `Refund ${refund.code} (${refund.method}) for order ${refund.orderId}`,
        postedBy: actorId,
        lines: [
          {
            accountCode: GL_ACCOUNT_CODES.SALES_RETURN_REFUND,
            debitAmount: refund.amount,
            branchId: refund.branchId,
            referenceType: 'SALES_ORDER',
            referenceId: refund.orderId,
            memo: `Sales return refund ${refund.code}`,
          },
          {
            accountCode: creditGl,
            creditAmount: refund.amount,
            branchId: refund.branchId,
            referenceType: 'SALES_ORDER',
            referenceId: refund.orderId,
            memo: `Refund payout (${refund.method}) ${refund.code}`,
          },
        ],
      },
    );

    let cashbookEntryId: string | null = null;
    if (cashAccount) {
      const cbEntry =
        await this.cashbookService.createAndOptionallyPostVoucherInTx(
          em,
          tenantId,
          {
            actorId,
            direction: 'EXPENSE',
            cashAccountId: cashAccount.id,
            categoryCode: 'CUSTOMER_REFUND',
            amount: refund.amount,
            branchId: refund.branchId ?? null,
            shiftId: refund.shiftId ?? null,
            voucherType: 'CUSTOMER_REFUND',
            sourceType: 'REFUND_OPERATION',
            sourceId: refund.id,
            description: `Customer refund ${refund.code} for order ${refund.orderId}`,
            referenceDoc: refund.code,
            autoPost: true,
            idempotencyKey: `rf-cb:${refund.id}`,
            skipJournalIfLinked: postedJournal.journal.id,
          },
        );
      cashbookEntryId = cbEntry.id;
    }

    const now = new Date();
    refund.status = 'COMPLETED';
    refund.cashAccountId = cashAccount?.id ?? refund.cashAccountId ?? null;
    refund.externalRefundRef =
      options.externalRefundRef ?? refund.externalRefundRef ?? null;
    refund.journalId = postedJournal.journal.id;
    refund.cashbookEntryId = cashbookEntryId;
    refund.failureReason = null;
    refund.completedAt = now;
    refund.version += 1;

    const saved = await em.getRepository(RefundOperationEntity).save(refund);

    await em.getRepository(ReconciliationIssueEntity).update(
      {
        tenantId,
        sourceType: 'REFUND_OPERATION',
        sourceId: saved.id,
        status: 'OPEN',
      },
      {
        status: 'RESOLVED',
        resolutionNote: `Refund ${saved.code} confirmed COMPLETED`,
        resolvedBy: actorId,
        resolvedAt: now,
      },
    );

    await this.outbox.add(
      em,
      FINANCE_REFUND_COMPLETED,
      {
        refundId: saved.id,
        code: saved.code,
        salesRefundRequestId: saved.salesRefundRequestId,
        returnId: saved.returnId,
        orderId: saved.orderId,
        amount: saved.amount,
        method: saved.method,
        status: saved.status,
        journalId: saved.journalId,
        occurredAt: now.toISOString(),
      } satisfies FinanceRefundEventPayload,
      { tenantId },
    );

    return saved;
  }

  private async lockOrderSettlementsInTx(
    em: EntityManager,
    tenantId: string,
    orderId: string,
    settlementId?: string,
  ): Promise<PaymentSettlementEntity[]> {
    const qb = em
      .getRepository(PaymentSettlementEntity)
      .createQueryBuilder('s')
      .setLock('pessimistic_write')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.order_id = :orderId', { orderId })
      .orderBy('s.created_at', 'ASC');

    if (settlementId) {
      qb.andWhere('s.id = :settlementId', { settlementId });
    }

    const settlements = await qb.getMany();
    if (settlements.length === 0) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.REFUND_NOT_ELIGIBLE,
        `Cannot process refund for order ${orderId}: no payment settlement found`,
        409,
      );
    }
    return settlements;
  }
}
