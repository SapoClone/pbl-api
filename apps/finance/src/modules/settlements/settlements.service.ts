import { Injectable } from '@nestjs/common';
import { EventEnvelope, TenantContext } from '@pbl/common';
import {
  FINANCE_PAYMENT_SETTLEMENT_CONFIRMED,
  FinancePaymentSettlementConfirmedPayload,
  OrderCompletedPayload,
  SALES_ORDER_COMPLETED,
  SALES_PAYMENT_CONFIRMED,
  SALES_TENDER_RECORDED,
} from '@pbl/contracts';
import { EventOutbox, OnEvent } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  FinanceDomainError,
  FinanceDomainErrorCode,
  formatMoneyCents,
  GL_ACCOUNT_CODES,
  parseMoneyCents,
} from '../../domain/finance-domain';
import { nextFinanceDocumentCode } from '../../infrastructure/persistence/finance-code.generator';
import {
  CashAccountEntity,
  PaymentSettlementEntity,
  ReconciliationIssueEntity,
} from '../../infrastructure/persistence/finance.entities';
import { applyBranchScope, BranchScope } from '../../presentation/branch-scope';
import { CashAccountsService } from '../cash-accounts/cash-accounts.service';
import { CashbookService } from '../cashbook/cashbook.service';
import { FinancialJournalService } from '../financial-journal/financial-journal.service';
import {
  ConfirmSettlementDto,
  ListSettlementsQueryDto,
  ProviderWebhookCallbackDto,
} from './settlements.dto';

@Injectable()
export class SettlementsService {
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

  async confirmSettlement(
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: ConfirmSettlementDto,
    tenantId = TenantContext.require(),
  ) {
    return this.runInTenantTx(tenantId, async (em) =>
      this.confirmSettlementInTx(
        em,
        tenantId,
        actorId,
        idempotencyKeyHeader,
        dto,
      ),
    );
  }

  async confirmSettlementInTx(
    em: EntityManager,
    tenantId: string,
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: ConfirmSettlementDto,
  ): Promise<{
    settlement: PaymentSettlementEntity;
    replayed: boolean;
  }> {
    const tenderRef = (
      dto.tenderRef ?? `tender:${dto.orderId}:${dto.paymentMethod}`
    ).trim();
    const provider = (dto.provider ?? 'INTERNAL_POS').trim().toUpperCase();
    const cleanKey = (
      idempotencyKeyHeader ??
      dto.idempotencyKey ??
      `stl:${dto.orderId}:${tenderRef}`
    )
      .trim()
      .toLowerCase();

    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `settlement:${tenantId}:${dto.orderId}:${tenderRef}`,
    ]);

    const repo = em.getRepository(PaymentSettlementEntity);

    // 1. Check idempotencyKey
    const existingByKey = await repo.findOne({
      where: { tenantId, idempotencyKey: cleanKey },
    });
    if (existingByKey) {
      return { settlement: existingByKey, replayed: true };
    }

    // 2. Check external provider transaction deduplication (Test J)
    if (dto.externalTxId) {
      const existingByExternal = await repo.findOne({
        where: {
          tenantId,
          provider,
          externalTxId: dto.externalTxId.trim(),
        },
      });
      if (existingByExternal) {
        return { settlement: existingByExternal, replayed: true };
      }
    }

    // 3. Check tenderRef deduplication on order
    const existingByTender = await repo.findOne({
      where: {
        tenantId,
        orderId: dto.orderId,
        tenderRef,
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (existingByTender && existingByTender.settlementStatus === 'SETTLED') {
      return { settlement: existingByTender, replayed: true };
    }

    const reqCents = parseMoneyCents(dto.requestedAmount, {
      allowZero: false,
      field: 'requestedAmount',
    });
    const confCents = dto.confirmedAmount
      ? parseMoneyCents(dto.confirmedAmount, {
          allowZero: true,
          field: 'confirmedAmount',
        })
      : reqCents;
    const settledCents = dto.settledAmount
      ? parseMoneyCents(dto.settledAmount, {
          allowZero: true,
          field: 'settledAmount',
        })
      : confCents;

    const reqStr = formatMoneyCents(reqCents);
    const confStr = formatMoneyCents(confCents);
    const settledStr = formatMoneyCents(settledCents);

    const hasMismatch = reqCents !== confCents || confCents <= 0n;
    const isAmbiguous = Boolean(dto.ambiguousOutcome) || hasMismatch;

    const code =
      existingByTender?.code ??
      (await nextFinanceDocumentCode(em, tenantId, 'STL'));
    const settlementId = existingByTender?.id ?? randomUUID();

    if (isAmbiguous) {
      const pendingEntity = repo.create({
        id: settlementId,
        tenantId,
        code,
        orderId: dto.orderId,
        checkoutId: dto.checkoutId ?? null,
        branchId: dto.branchId ?? null,
        shiftId: dto.shiftId ?? null,
        tenderRef,
        paymentMethod: dto.paymentMethod,
        provider,
        externalTxId: dto.externalTxId?.trim() ?? null,
        requestedAmount: reqStr,
        confirmedAmount: confStr,
        settledAmount: '0.00',
        refundedAmount: existingByTender?.refundedAmount ?? '0.00',
        currency: 'VND',
        providerStatus: hasMismatch ? 'AMOUNT_MISMATCH' : 'AMBIGUOUS',
        settlementStatus: 'RECONCILIATION_REQUIRED',
        cashbookEntryId: null,
        journalId: null,
        idempotencyKey: cleanKey,
        settledAt: null,
        version: (existingByTender?.version ?? 0) + 1,
      });
      const savedPending = await repo.save(pendingEntity);

      await em.getRepository(ReconciliationIssueEntity).save(
        em.getRepository(ReconciliationIssueEntity).create({
          id: randomUUID(),
          tenantId,
          runId: null,
          issueType: hasMismatch
            ? 'SETTLEMENT_AMOUNT_MISMATCH'
            : 'AMBIGUOUS_SETTLEMENT',
          severity: 'HIGH',
          sourceType: 'PAYMENT_SETTLEMENT',
          sourceId: savedPending.id,
          expectedAmount: reqStr,
          actualAmount: confStr,
          differenceAmount: formatMoneyCents(confCents - reqCents),
          status: 'OPEN',
          description: hasMismatch
            ? `Order ${dto.orderId} tender ${tenderRef} confirmed amount (${confStr}) != requested amount (${reqStr})`
            : `Order ${dto.orderId} tender ${tenderRef} reported ambiguous settlement outcome`,
          resolutionNote: null,
          resolvedBy: null,
          resolvedAt: null,
        }),
      );

      return { settlement: savedPending, replayed: false };
    }

    // Valid settlement -> resolve cash account & post balanced journal + cashbook entry
    let cashAccount: CashAccountEntity | null = null;
    if (
      ['CASH', 'BANK_TRANSFER', 'CARD', 'EWALLET'].includes(dto.paymentMethod)
    ) {
      if (dto.cashAccountId) {
        cashAccount = await em.getRepository(CashAccountEntity).findOne({
          where: { id: dto.cashAccountId, tenantId },
        });
      } else {
        cashAccount =
          await this.cashAccountsService.ensureDefaultCashAccountInTx(
            em,
            tenantId,
            dto.branchId ?? null,
            dto.paymentMethod === 'CASH' ? 'CASH_DRAWER' : 'BANK',
          );
      }
    }

    const debitGl =
      cashAccount?.glAccountCode ??
      this.resolveDebitGlForMethod(dto.paymentMethod);

    const postedJournal = await this.journalService.postJournalInTx(
      em,
      tenantId,
      {
        journalType: 'PAYMENT_SETTLEMENT',
        sourceType: 'PAYMENT_SETTLEMENT',
        sourceId: settlementId,
        idempotencyKey: `stl-jnl:${cleanKey}`,
        branchId: dto.branchId ?? null,
        description: `Payment settlement ${code} (${dto.paymentMethod}) for order ${dto.orderId}`,
        postedBy: actorId,
        lines: [
          {
            accountCode: debitGl,
            debitAmount: settledStr,
            branchId: dto.branchId ?? null,
            referenceType: 'SALES_ORDER',
            referenceId: dto.orderId,
            memo: `Settlement ${code} (${dto.paymentMethod})`,
          },
          {
            accountCode: GL_ACCOUNT_CODES.SALES_REVENUE_CLEARING,
            creditAmount: settledStr,
            branchId: dto.branchId ?? null,
            referenceType: 'SALES_ORDER',
            referenceId: dto.orderId,
            memo: `Order ${dto.orderId} settled revenue`,
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
            direction: 'RECEIPT',
            cashAccountId: cashAccount.id,
            categoryCode: 'SALES_RECEIPT',
            amount: settledStr,
            branchId: dto.branchId ?? null,
            shiftId: dto.shiftId ?? null,
            voucherType: 'SALES_SETTLEMENT',
            sourceType: 'PAYMENT_SETTLEMENT',
            sourceId: settlementId,
            description: `Receipt for order ${dto.orderId} (${code})`,
            referenceDoc: code,
            autoPost: true,
            idempotencyKey: `stl-cb:${cleanKey}`,
            skipJournalIfLinked: postedJournal.journal.id,
          },
        );
      cashbookEntryId = cbEntry.id;
    }

    const now = new Date();
    const entity = repo.create({
      id: settlementId,
      tenantId,
      code,
      orderId: dto.orderId,
      checkoutId: dto.checkoutId ?? null,
      branchId: dto.branchId ?? null,
      shiftId: dto.shiftId ?? null,
      tenderRef,
      paymentMethod: dto.paymentMethod,
      provider,
      externalTxId: dto.externalTxId?.trim() ?? null,
      requestedAmount: reqStr,
      confirmedAmount: confStr,
      settledAmount: settledStr,
      refundedAmount: existingByTender?.refundedAmount ?? '0.00',
      currency: 'VND',
      providerStatus: 'CONFIRMED',
      settlementStatus: 'SETTLED',
      cashbookEntryId,
      journalId: postedJournal.journal.id,
      idempotencyKey: cleanKey,
      settledAt: now,
      version: (existingByTender?.version ?? 0) + 1,
    });
    const saved = await repo.save(entity);

    if (
      existingByTender &&
      existingByTender.settlementStatus === 'RECONCILIATION_REQUIRED'
    ) {
      await em.getRepository(ReconciliationIssueEntity).update(
        {
          tenantId,
          sourceType: 'PAYMENT_SETTLEMENT',
          sourceId: saved.id,
          status: 'OPEN',
        },
        {
          status: 'RESOLVED',
          resolutionNote: `Resolved by verified settlement confirmation (${code})`,
          resolvedBy: actorId,
          resolvedAt: now,
        },
      );
    }

    await this.outbox.add(
      em,
      FINANCE_PAYMENT_SETTLEMENT_CONFIRMED,
      {
        settlementId: saved.id,
        code: saved.code,
        orderId: saved.orderId,
        checkoutId: saved.checkoutId,
        paymentMethod: saved.paymentMethod,
        provider: saved.provider,
        externalTxId: saved.externalTxId,
        confirmedAmount: saved.confirmedAmount,
        settlementStatus: saved.settlementStatus,
        journalId: saved.journalId,
        occurredAt: now.toISOString(),
      } satisfies FinancePaymentSettlementConfirmedPayload,
      { tenantId },
    );

    return { settlement: saved, replayed: false };
  }

  async processProviderCallback(
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: ProviderWebhookCallbackDto,
    tenantId = TenantContext.require(),
  ) {
    return this.confirmSettlement(
      actorId,
      idempotencyKeyHeader ??
        dto.idempotencyKey ??
        `webhook:${dto.provider}:${dto.externalTxId}`,
      {
        orderId: dto.orderId,
        checkoutId: dto.checkoutId,
        branchId: dto.branchId,
        tenderRef: dto.tenderRef ?? `${dto.provider}:${dto.externalTxId}`,
        paymentMethod: dto.paymentMethod ?? 'EWALLET',
        provider: dto.provider,
        externalTxId: dto.externalTxId,
        requestedAmount: dto.requestedAmount ?? dto.confirmedAmount,
        confirmedAmount: dto.confirmedAmount,
        settledAmount: dto.confirmedAmount,
        cashAccountId: dto.cashAccountId,
        ambiguousOutcome:
          dto.providerStatus === 'AMBIGUOUS' ||
          dto.providerStatus === 'PENDING' ||
          dto.providerStatus === 'FAILED',
        idempotencyKey:
          dto.idempotencyKey ?? `webhook:${dto.provider}:${dto.externalTxId}`,
      },
      tenantId,
    );
  }

  async getSettlementById(
    id: string,
    tenantId = TenantContext.require(),
  ): Promise<PaymentSettlementEntity> {
    return this.runInTenantTx(tenantId, async (em) => {
      const entity = await em
        .getRepository(PaymentSettlementEntity)
        .findOne({ where: { id, tenantId } });
      if (!entity) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.SETTLEMENT_NOT_FOUND,
          `Payment settlement ${id} not found`,
          404,
        );
      }
      return entity;
    });
  }

  async listSettlements(
    query: ListSettlementsQueryDto,
    tenantId = TenantContext.require(),
    scope: BranchScope = null,
  ) {
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    return this.runInTenantTx(tenantId, async (em) => {
      const where: Record<string, unknown> = { tenantId };
      if (query.orderId) {
        where.orderId = query.orderId;
      }
      if (query.settlementStatus) {
        where.settlementStatus = query.settlementStatus;
      }
      applyBranchScope(where, scope);
      const [items, total] = await em
        .getRepository(PaymentSettlementEntity)
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

  @OnEvent(SALES_ORDER_COMPLETED.type)
  async onSalesOrderCompleted(
    envelope: EventEnvelope<OrderCompletedPayload>,
  ): Promise<void> {
    const { tenantId, payload } = envelope;
    if (!tenantId || !payload?.orderId) {
      return;
    }
    const method = (payload.paymentMethod ?? 'CASH').toUpperCase();
    if (method === 'ON_ACCOUNT' || method === 'COD') {
      return;
    }
    const rawAmount = payload.grandTotal ?? String(payload.totalAmount ?? 0);
    const cents = parseMoneyCents(rawAmount, {
      allowZero: true,
      field: 'totalAmount',
    });
    if (cents <= 0n) {
      return;
    }
    await this.confirmSettlement(
      'event:sales.order.completed',
      `evt:stl:order:${payload.orderId}`,
      {
        orderId: payload.orderId,
        branchId: payload.branchId,
        tenderRef: `order:${payload.orderId}`,
        paymentMethod: (['CASH', 'BANK_TRANSFER', 'CARD', 'EWALLET'].includes(
          method,
        )
          ? method
          : 'CASH') as 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'EWALLET',
        provider: 'INTERNAL_POS',
        requestedAmount: formatMoneyCents(cents),
        confirmedAmount: formatMoneyCents(cents),
        settledAmount: formatMoneyCents(cents),
        idempotencyKey: `evt:stl:order:${payload.orderId}`,
      },
      tenantId,
    );
  }

  @OnEvent(SALES_TENDER_RECORDED.type)
  async onSalesTenderRecorded(
    envelope: EventEnvelope<{
      tenderId: string;
      orderId: string;
      branchId?: string;
      shiftId?: string;
      paymentMethod: string;
      provider?: string;
      externalReference?: string;
      amount: string;
    }>,
  ): Promise<void> {
    const { tenantId, payload } = envelope;
    if (!tenantId || !payload?.orderId || !payload?.tenderId) {
      return;
    }
    const method = (payload.paymentMethod ?? 'CASH').toUpperCase();
    if (method === 'ON_ACCOUNT' || method === 'COD') {
      return;
    }
    const cents = parseMoneyCents(payload.amount, {
      allowZero: true,
      field: 'amount',
    });
    if (cents <= 0n) {
      return;
    }
    await this.confirmSettlement(
      'event:sales.tender.recorded',
      `evt:stl:tender:${payload.tenderId}`,
      {
        orderId: payload.orderId,
        branchId: payload.branchId,
        shiftId: payload.shiftId,
        tenderRef: payload.tenderId,
        paymentMethod: (['CASH', 'BANK_TRANSFER', 'CARD', 'EWALLET'].includes(
          method,
        )
          ? method
          : 'CASH') as 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'EWALLET',
        provider: payload.provider ?? 'INTERNAL_POS',
        externalTxId: payload.externalReference,
        requestedAmount: formatMoneyCents(cents),
        confirmedAmount: formatMoneyCents(cents),
        settledAmount: formatMoneyCents(cents),
        idempotencyKey: `evt:stl:tender:${payload.tenderId}`,
      },
      tenantId,
    );
  }

  @OnEvent(SALES_PAYMENT_CONFIRMED.type)
  async onSalesPaymentConfirmed(
    envelope: EventEnvelope<{
      paymentId: string;
      orderId: string;
      checkoutId?: string;
      branchId?: string;
      paymentMethod?: string;
      provider?: string;
      externalTxId?: string;
      amount: string;
    }>,
  ): Promise<void> {
    const { tenantId, payload } = envelope;
    if (!tenantId || !payload?.orderId || !payload?.paymentId) {
      return;
    }
    const cents = parseMoneyCents(payload.amount, {
      allowZero: true,
      field: 'amount',
    });
    if (cents <= 0n) {
      return;
    }
    await this.confirmSettlement(
      'event:sales.payment.confirmed',
      `evt:stl:pay:${payload.paymentId}`,
      {
        orderId: payload.orderId,
        checkoutId: payload.checkoutId,
        branchId: payload.branchId,
        tenderRef: payload.paymentId,
        paymentMethod: (payload.paymentMethod ?? 'EWALLET') as
          | 'CASH'
          | 'BANK_TRANSFER'
          | 'CARD'
          | 'EWALLET',
        provider: payload.provider ?? 'GATEWAY',
        externalTxId: payload.externalTxId,
        requestedAmount: formatMoneyCents(cents),
        confirmedAmount: formatMoneyCents(cents),
        settledAmount: formatMoneyCents(cents),
        idempotencyKey: `evt:stl:pay:${payload.paymentId}`,
      },
      tenantId,
    );
  }

  private resolveDebitGlForMethod(method: string): string {
    switch (method) {
      case 'CASH':
        return GL_ACCOUNT_CODES.CASH_ON_HAND;
      case 'BANK_TRANSFER':
      case 'CARD':
      case 'EWALLET':
        return GL_ACCOUNT_CODES.CASH_AT_BANK;
      case 'COD':
        return GL_ACCOUNT_CODES.COD_CARRIER_RECEIVABLE;
      case 'ON_ACCOUNT':
        return GL_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE;
      default:
        return GL_ACCOUNT_CODES.CASH_ON_HAND;
    }
  }
}
