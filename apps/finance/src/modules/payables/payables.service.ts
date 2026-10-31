import { Injectable } from '@nestjs/common';
import { EventEnvelope, TenantContext } from '@pbl/common';
import {
  FINANCE_PAYABLE_CREATED,
  FINANCE_PAYABLE_PAYMENT_APPLIED,
  FinancePayableEventPayload,
  INVENTORY_PURCHASE_ORDER_APPROVED,
  INVENTORY_STOCK_RECEIVED,
  PurchaseOrderApprovedPayload,
} from '@pbl/contracts';
import { EventOutbox, OnEvent } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { toMoney } from '../../common/money';
import {
  calculateDocumentAllocations,
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
  SupplierDebtLedgerEntity,
  SupplierPayableEntity,
} from '../../infrastructure/persistence/finance.entities';
import { CashAccountsService } from '../cash-accounts/cash-accounts.service';
import { CashbookService } from '../cashbook/cashbook.service';
import { FinancialJournalService } from '../financial-journal/financial-journal.service';
import {
  ApplySupplierReturnCreditDto,
  ListPayablesQueryDto,
  RecognizePayableDto,
  RecordSupplierPaymentDto,
} from './payables.dto';

@Injectable()
export class PayablesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly journalService: FinancialJournalService,
    private readonly cashAccountsService: CashAccountsService,
    private readonly cashbookService: CashbookService,
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

  private async computeSupplierTotalDebtInTx(
    em: EntityManager,
    tenantId: string,
    supplierId: string,
  ): Promise<number> {
    const rows: Array<{ total: string | null }> = await em.query(
      `SELECT COALESCE(SUM("outstanding_amount"), 0)::bigint AS "total"
       FROM ${this.schemaPrefix}"supplier_payables"
       WHERE "tenant_id" = $1 AND "supplier_id" = $2 AND "status" IN ('OPEN', 'PARTIALLY_PAID')`,
      [tenantId, supplierId],
    );
    return toMoney(rows[0]?.total ?? 0);
  }

  async recognizePayable(
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: RecognizePayableDto,
    tenantId = TenantContext.require(),
  ) {
    const amountVnd = parseVnd(dto.amount, {
      allowZero: false,
      field: 'amount',
    });
    const sourceType = (
      dto.sourceType ??
      (dto.purchaseOrderId ? 'PURCHASE_ORDER' : 'SUPPLIER_INVOICE')
    )
      .trim()
      .toUpperCase();
    const sourceId = (
      dto.sourceId ??
      dto.purchaseOrderId ??
      dto.receiptId ??
      `manual:${dto.supplierId}:${amountVnd}`
    ).trim();
    const idempotencyKey = (
      idempotencyKeyHeader ??
      dto.idempotencyKey ??
      `ap:${sourceType}:${sourceId}`
    )
      .trim()
      .toLowerCase();

    return this.runInTenantTx(tenantId, async (em) => {
      // Advisory lock per supplier to serialize payable recognition and balance computation
      await em.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [tenantId, `supplier-ap:${dto.supplierId}`],
      );

      const apRepo = em.getRepository(SupplierPayableEntity);
      const ledgerRepo = em.getRepository(SupplierDebtLedgerEntity);

      // Deduplicate by (tenantId, sourceType, sourceId), (tenantId, idempotencyKey), OR (tenantId, purchaseOrderId) (Test G)
      const whereConditions: Record<string, unknown>[] = [
        { tenantId, sourceType, sourceId },
        { tenantId, idempotencyKey },
      ];
      if (dto.purchaseOrderId) {
        whereConditions.push({
          tenantId,
          purchaseOrderId: dto.purchaseOrderId,
        });
      }

      const existing = await apRepo.findOne({ where: whereConditions });
      if (existing) {
        if (dto.receiptId && !existing.receiptId) {
          existing.receiptId = dto.receiptId;
          existing.updatedAt = new Date();
          await apRepo.save(existing);
        }
        const totalDebt = await this.computeSupplierTotalDebtInTx(
          em,
          tenantId,
          dto.supplierId,
        );
        return {
          ...existing,
          supplierTotalDebtAfter: totalDebt,
          replayed: true,
        };
      }

      const debtBeforeVnd = await this.computeSupplierTotalDebtInTx(
        em,
        tenantId,
        dto.supplierId,
      );
      const debtAfterVnd = debtBeforeVnd + amountVnd;

      const postedJournal = await this.journalService.postJournalInTx(
        em,
        tenantId,
        {
          journalType: 'SUPPLIER_PAYABLE_RECOGNITION',
          sourceType,
          sourceId,
          idempotencyKey: `ap-jnl:${idempotencyKey}`,
          description:
            dto.note ??
            `Supplier payable recognized for ${sourceType}:${sourceId}`,
          postedBy: actorId,
          lines: [
            {
              accountCode: GL_ACCOUNT_CODES.INVENTORY_PURCHASE_CLEARING,
              debitAmount: amountVnd,
              partyType: 'SUPPLIER',
              partyId: dto.supplierId,
              memo: `Inventory/purchase clearing for ${sourceType}:${sourceId}`,
            },
            {
              accountCode: GL_ACCOUNT_CODES.ACCOUNTS_PAYABLE,
              creditAmount: amountVnd,
              partyType: 'SUPPLIER',
              partyId: dto.supplierId,
              memo: `Supplier payable for ${sourceType}:${sourceId}`,
            },
          ],
        },
      );

      const code = await nextFinanceDocumentCode(em, tenantId, 'AP');
      const now = new Date();
      const payable = apRepo.create({
        id: randomUUID(),
        tenantId,
        code,
        supplierId: dto.supplierId,
        purchaseOrderId: dto.purchaseOrderId ?? null,
        receiptId: dto.receiptId ?? null,
        warehouseId: dto.warehouseId ?? null,
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
      await apRepo.save(payable);

      const ledgerEntry = ledgerRepo.create({
        id: randomUUID(),
        tenantId,
        supplierId: dto.supplierId,
        payableId: payable.id,
        entryType: 'PAYABLE_RECOGNIZED',
        amountDelta: amountVnd,
        balanceBefore: debtBeforeVnd,
        balanceAfter: debtAfterVnd,
        paymentMethod: null,
        cashbookEntryId: null,
        journalId: postedJournal.journal.id,
        referenceType: sourceType,
        referenceId: sourceId,
        idempotencyKey: `ap-ldg:${idempotencyKey}`,
        note: dto.note ?? null,
        actorId,
        occurredAt: now,
      });
      await ledgerRepo.save(ledgerEntry);

      await this.outbox.add(
        em,
        FINANCE_PAYABLE_CREATED,
        {
          payableId: payable.id,
          code: payable.code,
          supplierId: payable.supplierId,
          purchaseOrderId: payable.purchaseOrderId,
          receiptId: payable.receiptId,
          warehouseId: payable.warehouseId,
          originalAmount: payable.originalAmount,
          paidAmount: payable.paidAmount,
          outstandingAmount: payable.outstandingAmount,
          supplierTotalDebtAfter: debtAfterVnd,
          status: payable.status,
          journalId: payable.journalId,
          occurredAt: now.toISOString(),
        } satisfies FinancePayableEventPayload,
        { tenantId },
      );

      return {
        ...payable,
        supplierTotalDebtAfter: debtAfterVnd,
        replayed: false,
      };
    });
  }

  async recordSupplierPayment(
    targetPayableId: string,
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: RecordSupplierPaymentDto,
    tenantId = TenantContext.require(),
  ) {
    const cleanKey = (
      idempotencyKeyHeader ??
      dto.idempotencyKey ??
      `ap-pay:${randomUUID()}`
    )
      .trim()
      .toLowerCase();

    return this.runInTenantTx(tenantId, async (em) => {
      const apRepo = em.getRepository(SupplierPayableEntity);
      const ledgerRepo = em.getRepository(SupplierDebtLedgerEntity);

      const existingLedger = await ledgerRepo.findOne({
        where: [
          { tenantId, idempotencyKey: cleanKey },
          { tenantId, idempotencyKey: `${cleanKey}:1` },
        ],
      });
      if (existingLedger) {
        const ap = await apRepo.findOne({
          where: { id: existingLedger.payableId, tenantId },
        });
        const totalDebt = await this.computeSupplierTotalDebtInTx(
          em,
          tenantId,
          existingLedger.supplierId,
        );
        return {
          payable: ap,
          supplierTotalDebtAfter: totalDebt,
          journalId: existingLedger.journalId,
          cashbookEntryId: existingLedger.cashbookEntryId,
          replayed: true,
        };
      }

      const target = await apRepo.findOne({
        where: { id: targetPayableId, tenantId },
      });
      if (!target) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.PAYABLE_NOT_FOUND,
          `Supplier payable ${targetPayableId} not found`,
          404,
        );
      }

      await em.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [tenantId, `supplier-ap:${target.supplierId}`],
      );

      const openDocs = await apRepo.find({
        where: dto.allocations?.length
          ? {
              tenantId,
              supplierId: target.supplierId,
              status: In(['OPEN', 'PARTIALLY_PAID']),
            }
          : { id: targetPayableId, tenantId },
        order: { createdAt: 'ASC', id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });

      const explicitAllocs = dto.allocations?.map((a) => ({
        documentId: a.payableId,
        amount: a.amount,
      }));

      const allocationResult = calculateDocumentAllocations(
        dto.amount,
        openDocs,
        explicitAllocs,
        {
          overpaymentPolicy: 'REJECT',
          kind: 'PAYABLE',
        },
      );

      const paymentMethod = dto.paymentMethod ?? 'BANK_TRANSFER';
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
            dto.branchId ?? null,
            paymentMethod === 'CASH' ? 'CASH_DRAWER' : 'BANK',
          );
      }

      const postedJournal = await this.journalService.postJournalInTx(
        em,
        tenantId,
        {
          journalType: 'SUPPLIER_PAYMENT',
          sourceType: 'SUPPLIER_PAYMENT',
          sourceId: cleanKey,
          idempotencyKey: `ap-pay-jnl:${cleanKey}`,
          branchId: dto.branchId ?? null,
          description:
            dto.note ??
            `Supplier payment for ${allocationResult.allocations.map((a) => a.code).join(', ')}`,
          postedBy: actorId,
          lines: [
            {
              accountCode: GL_ACCOUNT_CODES.ACCOUNTS_PAYABLE,
              debitAmount: allocationResult.totalAllocated,
              branchId: dto.branchId ?? null,
              partyType: 'SUPPLIER',
              partyId: target.supplierId,
              memo: `Payment allocated to ${allocationResult.allocations.map((a) => a.code).join(', ')}`,
            },
            {
              accountCode: cashAccount.glAccountCode,
              creditAmount: allocationResult.totalAllocated,
              branchId: dto.branchId ?? null,
              partyType: 'SUPPLIER',
              partyId: target.supplierId,
              memo: `Supplier payment (${paymentMethod})`,
            },
          ],
        },
      );

      const cashbookEntry =
        await this.cashbookService.createAndOptionallyPostVoucherInTx(
          em,
          tenantId,
          {
            actorId,
            direction: 'EXPENSE',
            cashAccountId: cashAccount.id,
            categoryCode: 'SUPPLIER_PAYMENT',
            amount: allocationResult.totalAllocated,
            branchId: dto.branchId ?? null,
            voucherType: 'SUPPLIER_PAYMENT',
            sourceType: 'SUPPLIER_PAYMENT',
            sourceId: cleanKey,
            partyType: 'SUPPLIER',
            partyId: target.supplierId,
            description:
              dto.note ??
              `Supplier payment for ${allocationResult.allocations.map((a) => a.code).join(', ')}`,
            autoPost: true,
            idempotencyKey: `cb-ap-pay:${cleanKey}`,
            skipJournalIfLinked: postedJournal.journal.id,
          },
        );

      let runningDebtVnd = await this.computeSupplierTotalDebtInTx(
        em,
        tenantId,
        target.supplierId,
      );
      const docMap = new Map(openDocs.map((d) => [d.id, d]));
      const now = new Date();
      const updatedPayables: SupplierPayableEntity[] = [];

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
        await apRepo.save(doc);
        updatedPayables.push(doc);

        const ledgerEntry = ledgerRepo.create({
          id: randomUUID(),
          tenantId,
          supplierId: target.supplierId,
          payableId: doc.id,
          entryType: 'PAYMENT_APPLIED',
          amountDelta: -alloc.allocatedAmount,
          balanceBefore: debtBeforeVnd,
          balanceAfter: debtAfterVnd,
          paymentMethod,
          cashbookEntryId: cashbookEntry.id,
          journalId: postedJournal.journal.id,
          referenceType: 'SUPPLIER_PAYMENT',
          referenceId: cleanKey,
          idempotencyKey:
            allocationResult.allocations.length === 1
              ? cleanKey
              : `${cleanKey}:${i + 1}`,
          note: dto.note ?? `Supplier payment applied to ${doc.code}`,
          actorId,
          occurredAt: now,
        });
        await ledgerRepo.save(ledgerEntry);
      }

      const primaryAp = updatedPayables[0];
      await this.outbox.add(
        em,
        FINANCE_PAYABLE_PAYMENT_APPLIED,
        {
          payableId: primaryAp.id,
          code: primaryAp.code,
          supplierId: primaryAp.supplierId,
          purchaseOrderId: primaryAp.purchaseOrderId,
          receiptId: primaryAp.receiptId,
          warehouseId: primaryAp.warehouseId,
          originalAmount: primaryAp.originalAmount,
          paidAmount: primaryAp.paidAmount,
          outstandingAmount: primaryAp.outstandingAmount,
          supplierTotalDebtAfter: runningDebtVnd,
          status: primaryAp.status,
          journalId: postedJournal.journal.id,
          occurredAt: now.toISOString(),
        } satisfies FinancePayableEventPayload,
        { tenantId },
      );

      return {
        payable: primaryAp,
        updatedPayables,
        allocations: allocationResult.allocations,
        totalAllocated: allocationResult.totalAllocated,
        supplierTotalDebtAfter: runningDebtVnd,
        journalId: postedJournal.journal.id,
        cashbookEntryId: cashbookEntry.id,
        replayed: false,
      };
    });
  }

  async applySupplierReturnCredit(
    payableId: string,
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: ApplySupplierReturnCreditDto,
    tenantId = TenantContext.require(),
  ) {
    const creditVnd = parseVnd(dto.amount, {
      allowZero: false,
      field: 'amount',
    });
    const cleanKey = (
      idempotencyKeyHeader ??
      dto.idempotencyKey ??
      `ap-ret-credit:${dto.returnRefId}`
    )
      .trim()
      .toLowerCase();

    return this.runInTenantTx(tenantId, async (em) => {
      const apRepo = em.getRepository(SupplierPayableEntity);
      const ledgerRepo = em.getRepository(SupplierDebtLedgerEntity);

      const existing = await ledgerRepo.findOne({
        where: { tenantId, idempotencyKey: cleanKey },
      });
      if (existing) {
        const ap = await apRepo.findOne({
          where: { id: existing.payableId, tenantId },
        });
        return { payable: ap, replayed: true };
      }

      const payable = await apRepo.findOne({
        where: { id: payableId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payable) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.PAYABLE_NOT_FOUND,
          `Supplier payable ${payableId} not found`,
          404,
        );
      }

      const outBeforeVnd = parseVnd(payable.outstandingAmount, {
        allowZero: true,
        field: 'outstandingAmount',
      });
      if (creditVnd > outBeforeVnd) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.SUPPLIER_PAYMENT_EXCEEDED,
          `Supplier return credit (${creditVnd}) exceeds payable outstanding amount (${payable.outstandingAmount})`,
          409,
        );
      }

      const debtBeforeVnd = await this.computeSupplierTotalDebtInTx(
        em,
        tenantId,
        payable.supplierId,
      );
      const debtAfterVnd =
        debtBeforeVnd >= creditVnd ? debtBeforeVnd - creditVnd : 0;

      const postedJournal = await this.journalService.postJournalInTx(
        em,
        tenantId,
        {
          journalType: 'SUPPLIER_RETURN_CREDIT',
          sourceType: 'SUPPLIER_RETURN',
          sourceId: dto.returnRefId,
          idempotencyKey: `ap-ret-jnl:${cleanKey}`,
          description:
            dto.reason ??
            `Supplier return credit ${dto.returnRefId} on ${payable.code}`,
          postedBy: actorId,
          lines: [
            {
              accountCode: GL_ACCOUNT_CODES.ACCOUNTS_PAYABLE,
              debitAmount: creditVnd,
              partyType: 'SUPPLIER',
              partyId: payable.supplierId,
              memo: `Supplier return credit ${dto.returnRefId}`,
            },
            {
              accountCode: GL_ACCOUNT_CODES.INVENTORY_PURCHASE_CLEARING,
              creditAmount: creditVnd,
              partyType: 'SUPPLIER',
              partyId: payable.supplierId,
              memo: `Inventory return reduction ${dto.returnRefId}`,
            },
          ],
        },
      );

      const adjBeforeVnd = parseVnd(payable.adjustedAmount, {
        allowZero: true,
        field: 'adjustedAmount',
      });
      const outAfterVnd = outBeforeVnd - creditVnd;
      const now = new Date();

      payable.adjustedAmount = adjBeforeVnd + creditVnd;
      payable.outstandingAmount = outAfterVnd;
      payable.status =
        outAfterVnd === 0
          ? parseVnd(payable.paidAmount, { allowZero: true }) > 0
            ? 'PAID'
            : 'ADJUSTED'
          : 'PARTIALLY_PAID';
      payable.version += 1;
      payable.updatedAt = now;
      await apRepo.save(payable);

      const ledgerEntry = ledgerRepo.create({
        id: randomUUID(),
        tenantId,
        supplierId: payable.supplierId,
        payableId: payable.id,
        entryType: 'SUPPLIER_RETURN_CREDIT',
        amountDelta: -creditVnd,
        balanceBefore: debtBeforeVnd,
        balanceAfter: debtAfterVnd,
        paymentMethod: null,
        cashbookEntryId: null,
        journalId: postedJournal.journal.id,
        referenceType: 'SUPPLIER_RETURN',
        referenceId: dto.returnRefId,
        idempotencyKey: cleanKey,
        note: dto.reason ?? null,
        actorId,
        occurredAt: now,
      });
      await ledgerRepo.save(ledgerEntry);

      return {
        payable,
        supplierTotalDebtAfter: debtAfterVnd,
        journalId: postedJournal.journal.id,
        replayed: false,
      };
    });
  }

  @OnEvent(INVENTORY_PURCHASE_ORDER_APPROVED.type)
  async onPurchaseOrderApproved(
    envelope: EventEnvelope<PurchaseOrderApprovedPayload>,
  ): Promise<void> {
    const { tenantId, payload } = envelope;
    if (!tenantId || !payload?.purchaseOrderId || !payload?.supplierId) {
      return;
    }
    const amtVnd = parseVnd(payload.totalAmount, {
      allowZero: true,
      field: 'totalAmount',
    });
    if (amtVnd <= 0) {
      return;
    }
    await this.recognizePayable(
      'event:inventory.purchase_order.approved',
      `po-approved:${payload.purchaseOrderId}`,
      {
        supplierId: payload.supplierId,
        amount: amtVnd,
        purchaseOrderId: payload.purchaseOrderId,
        warehouseId: payload.warehouseId,
        sourceType: 'PURCHASE_ORDER',
        sourceId: payload.purchaseOrderId,
        note: `Auto-recognized from approved PO ${payload.code}`,
      },
      tenantId,
    );
  }

  @OnEvent(INVENTORY_STOCK_RECEIVED.type)
  async onStockReceived(
    envelope: EventEnvelope<{
      receiptId: string;
      code: string;
      warehouseId: string;
      sourceType: string;
      purchaseOrderId?: string | null;
      supplierId?: string | null;
      totalAmount?: number;
      postedAt: string;
    }>,
  ): Promise<void> {
    const { tenantId, payload } = envelope;
    if (!tenantId || !payload?.supplierId || !payload?.totalAmount) {
      return;
    }
    const amtVnd = parseVnd(payload.totalAmount, {
      allowZero: true,
      field: 'totalAmount',
    });
    if (amtVnd <= 0) {
      return;
    }
    await this.recognizePayable(
      'event:inventory.stock.received',
      `stock-rcv:${payload.purchaseOrderId ?? payload.receiptId}`,
      {
        supplierId: payload.supplierId,
        amount: amtVnd,
        purchaseOrderId: payload.purchaseOrderId ?? undefined,
        receiptId: payload.receiptId,
        warehouseId: payload.warehouseId,
        sourceType: payload.purchaseOrderId
          ? 'PURCHASE_ORDER'
          : 'STOCK_RECEIPT',
        sourceId: payload.purchaseOrderId ?? payload.receiptId,
        note: `Auto-recognized from stock receipt ${payload.code}`,
      },
      tenantId,
    );
  }

  async getPayableById(
    id: string,
    tenantId = TenantContext.require(),
  ): Promise<SupplierPayableEntity> {
    return this.runInTenantTx(tenantId, async (em) => {
      const ap = await em
        .getRepository(SupplierPayableEntity)
        .findOne({ where: { id, tenantId } });
      if (!ap) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.PAYABLE_NOT_FOUND,
          `Supplier payable ${id} not found`,
          404,
        );
      }
      return ap;
    });
  }

  async listPayables(
    query: ListPayablesQueryDto,
    tenantId = TenantContext.require(),
  ) {
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    return this.runInTenantTx(tenantId, async (em) => {
      const where: Record<string, unknown> = { tenantId };
      if (query.supplierId) {
        where.supplierId = query.supplierId;
      }
      if (query.purchaseOrderId) {
        where.purchaseOrderId = query.purchaseOrderId;
      }
      if (query.status) {
        where.status = query.status;
      }

      const [items, total] = await em
        .getRepository(SupplierPayableEntity)
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

  async getSupplierDebtSummary(
    supplierId: string,
    tenantId = TenantContext.require(),
  ) {
    return this.runInTenantTx(tenantId, async (em) => {
      const totalDebtVnd = await this.computeSupplierTotalDebtInTx(
        em,
        tenantId,
        supplierId,
      );
      const payables = await em.getRepository(SupplierPayableEntity).find({
        where: { tenantId, supplierId },
        order: { createdAt: 'DESC' },
        take: 50,
      });
      const ledger = await em.getRepository(SupplierDebtLedgerEntity).find({
        where: { tenantId, supplierId },
        order: { occurredAt: 'DESC', id: 'DESC' },
        take: 50,
      });

      return {
        supplierId,
        tenantId,
        totalOutstandingPayable: totalDebtVnd,
        openPayablesCount: payables.filter(
          (p) => p.status === 'OPEN' || p.status === 'PARTIALLY_PAID',
        ).length,
        payables,
        ledger,
      };
    });
  }
}
