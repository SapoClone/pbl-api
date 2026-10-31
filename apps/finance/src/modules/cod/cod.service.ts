import { Injectable } from '@nestjs/common';
import { EventEnvelope, TenantContext } from '@pbl/common';
import {
  FINANCE_COD_DISCREPANCY_DETECTED,
  FINANCE_COD_SETTLEMENT_RECONCILED,
  FinanceCodSettlementEventPayload,
  SALES_FULFILLMENT_COMPLETED,
} from '@pbl/contracts';
import { EventOutbox, OnEvent } from '@pbl/events';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  evaluateCodSettlementLine,
  FinanceDomainError,
  FinanceDomainErrorCode,
  GL_ACCOUNT_CODES,
  parseVnd,
} from '../../domain/finance-domain';
import { nextFinanceDocumentCode } from '../../infrastructure/persistence/finance-code.generator';
import {
  CashAccountEntity,
  CodReceivableEntity,
  CodSettlementBatchEntity,
  CodSettlementLineEntity,
  ReconciliationIssueEntity,
} from '../../infrastructure/persistence/finance.entities';
import { applyBranchScope, BranchScope } from '../../presentation/branch-scope';
import { CashAccountsService } from '../cash-accounts/cash-accounts.service';
import { CashbookService } from '../cashbook/cashbook.service';
import { FinancialJournalService } from '../financial-journal/financial-journal.service';
import {
  CreateCodReceivableDto,
  ImportCodSettlementBatchDto,
  ListCodBatchesQueryDto,
  ListCodReceivablesQueryDto,
  ReconcileCodBatchDto,
} from './cod.dto';

@Injectable()
export class CodService {
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

  async createCodReceivable(
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: CreateCodReceivableDto,
    tenantId = TenantContext.require(),
  ): Promise<{ receivable: CodReceivableEntity; replayed: boolean }> {
    return this.runInTenantTx(tenantId, async (em) =>
      this.createCodReceivableInTx(
        em,
        tenantId,
        actorId,
        idempotencyKeyHeader,
        dto,
      ),
    );
  }

  async createCodReceivableInTx(
    em: EntityManager,
    tenantId: string,
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: CreateCodReceivableDto,
  ): Promise<{ receivable: CodReceivableEntity; replayed: boolean }> {
    const carrierCode = dto.carrierCode.trim().toUpperCase();
    const trackingNumber = dto.trackingNumber.trim();
    const fulfillmentId = dto.fulfillmentId ?? dto.orderId;

    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `cod-ar:${tenantId}:${carrierCode}:${trackingNumber}`,
    ]);

    const repo = em.getRepository(CodReceivableEntity);
    const existing = await repo.findOne({
      where: [
        { tenantId, carrierCode, trackingNumber },
        { tenantId, fulfillmentId },
      ],
    });
    if (existing) {
      return { receivable: existing, replayed: true };
    }

    const expectedVnd = parseVnd(dto.expectedCodAmount, {
      allowZero: false,
      field: 'expectedCodAmount',
    });

    const code = await nextFinanceDocumentCode(em, tenantId, 'COD');
    const receivableId = randomUUID();
    const cleanKey = (
      idempotencyKeyHeader ??
      dto.idempotencyKey ??
      `cod-ar:${carrierCode}:${trackingNumber}`
    )
      .trim()
      .toLowerCase();

    const postedJournal = await this.journalService.postJournalInTx(
      em,
      tenantId,
      {
        journalType: 'COD_RECEIVABLE',
        sourceType: 'COD_RECEIVABLE',
        sourceId: receivableId,
        idempotencyKey: `cod-jnl:${cleanKey}`,
        branchId: dto.branchId ?? null,
        description: `Recognize COD receivable ${code} (${carrierCode} ${trackingNumber})`,
        postedBy: actorId,
        lines: [
          {
            accountCode: GL_ACCOUNT_CODES.COD_CARRIER_RECEIVABLE,
            debitAmount: expectedVnd,
            branchId: dto.branchId ?? null,
            partyType: 'CARRIER',
            partyId: carrierCode,
            referenceType: 'SALES_ORDER',
            referenceId: dto.orderId,
            memo: `COD receivable ${trackingNumber}`,
          },
          {
            accountCode: GL_ACCOUNT_CODES.SALES_REVENUE_CLEARING,
            creditAmount: expectedVnd,
            branchId: dto.branchId ?? null,
            partyType: 'CARRIER',
            partyId: carrierCode,
            referenceType: 'SALES_ORDER',
            referenceId: dto.orderId,
            memo: `COD sales revenue for order ${dto.orderId}`,
          },
        ],
      },
    );

    const receivable = repo.create({
      id: receivableId,
      tenantId,
      code,
      orderId: dto.orderId,
      fulfillmentId,
      branchId: dto.branchId ?? null,
      carrierCode,
      trackingNumber,
      expectedCodAmount: expectedVnd,
      reportedCollectedAmount: 0,
      carrierFeeAmount: 0,
      adjustmentAmount: 0,
      expectedNetAmount: expectedVnd,
      actualRemittedAmount: 0,
      discrepancyAmount: 0,
      status: 'COD_RECEIVABLE_RECOGNIZED',
      settlementBatchId: null,
      journalId: postedJournal.journal.id,
      deliveredAt: new Date(),
      reconciledAt: null,
      version: 1,
    });

    const saved = await repo.save(receivable);
    return { receivable: saved, replayed: false };
  }

  async importSettlementBatch(
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: ImportCodSettlementBatchDto,
    tenantId = TenantContext.require(),
  ): Promise<{
    batch: CodSettlementBatchEntity;
    lines: CodSettlementLineEntity[];
    replayed: boolean;
  }> {
    return this.runInTenantTx(tenantId, async (em) => {
      const carrierCode = dto.carrierCode.trim().toUpperCase();
      const statementRef = dto.statementRef.trim();
      const canonicalPayload = JSON.stringify({
        carrierCode,
        statementRef,
        lines: dto.lines.map((l) => ({
          trackingNumber: l.trackingNumber.trim(),
          reportedCodAmount: l.reportedCodAmount,
          carrierFeeAmount: l.carrierFeeAmount ?? 0,
          netPayoutAmount: l.netPayoutAmount,
        })),
      });
      const fileChecksum =
        dto.fileChecksum?.trim() ??
        createHash('sha256').update(canonicalPayload).digest('hex');
      const cleanKey = (
        idempotencyKeyHeader ??
        dto.idempotencyKey ??
        `codb:${carrierCode}:${statementRef}`
      )
        .trim()
        .toLowerCase();

      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `cod-batch:${tenantId}:${carrierCode}:${statementRef}`,
      ]);

      const batchRepo = em.getRepository(CodSettlementBatchEntity);
      const lineRepo = em.getRepository(CodSettlementLineEntity);

      // Deduplicate by (carrierCode, statementRef), fileChecksum, or idempotencyKey (Test K)
      const existingBatch = await batchRepo.findOne({
        where: [
          { tenantId, carrierCode, statementRef },
          { tenantId, fileChecksum },
          { tenantId, idempotencyKey: cleanKey },
        ],
      });
      if (existingBatch) {
        const existingLines = await lineRepo.find({
          where: { tenantId, batchId: existingBatch.id },
          order: { lineNo: 'ASC' },
        });
        return {
          batch: existingBatch,
          lines: existingLines,
          replayed: true,
        };
      }

      const code = await nextFinanceDocumentCode(em, tenantId, 'BAT');
      const batchId = randomUUID();

      let totalReportedVnd = 0;
      let totalFeeVnd = 0;
      let totalNetVnd = 0;

      const lineEntities: CodSettlementLineEntity[] = [];
      for (let i = 0; i < dto.lines.length; i += 1) {
        const lineDto = dto.lines[i];
        const reportedVnd = parseVnd(lineDto.reportedCodAmount, {
          allowZero: true,
          field: `lines[${i}].reportedCodAmount`,
        });
        const feeVnd = parseVnd(lineDto.carrierFeeAmount ?? 0, {
          allowZero: true,
          field: `lines[${i}].carrierFeeAmount`,
        });
        const netVnd = parseVnd(lineDto.netPayoutAmount, {
          allowZero: true,
          allowNegative: true,
          field: `lines[${i}].netPayoutAmount`,
        });

        totalReportedVnd += reportedVnd;
        totalFeeVnd += feeVnd;
        totalNetVnd += netVnd;

        lineEntities.push(
          lineRepo.create({
            id: randomUUID(),
            tenantId,
            batchId,
            lineNo: i + 1,
            codReceivableId: null,
            fulfillmentId: lineDto.fulfillmentId ?? null,
            orderId: lineDto.orderId ?? null,
            trackingNumber: lineDto.trackingNumber.trim(),
            expectedCodAmount: 0,
            reportedCodAmount: reportedVnd,
            carrierFeeAmount: feeVnd,
            netPayoutAmount: netVnd,
            discrepancyAmount: 0,
            lineStatus: 'MATCHED',
            discrepancyReason: null,
          }),
        );
      }

      let batch = batchRepo.create({
        id: batchId,
        tenantId,
        code,
        carrierCode,
        statementRef,
        fileChecksum,
        cashAccountId: dto.cashAccountId ?? null,
        periodFrom: null,
        periodTo: null,
        totalExpectedCod: 0,
        totalReportedCod: totalReportedVnd,
        totalCarrierFee: totalFeeVnd,
        totalNetPayout: totalNetVnd,
        totalDiscrepancy: 0,
        lineCount: lineEntities.length,
        matchedCount: 0,
        discrepancyCount: 0,
        status: 'IMPORTED',
        journalId: null,
        cashbookEntryId: null,
        idempotencyKey: cleanKey,
        importedBy: actorId,
        reconciledBy: null,
        reconciledAt: null,
      });

      batch = await batchRepo.save(batch);
      const savedLines = await lineRepo.save(lineEntities);

      if (dto.autoReconcile !== false) {
        const reconciled = await this.reconcileBatchInTx(
          em,
          tenantId,
          actorId,
          batch.id,
          { cashAccountId: dto.cashAccountId },
        );
        return {
          batch: reconciled.batch,
          lines: reconciled.lines,
          replayed: false,
        };
      }

      return { batch, lines: savedLines, replayed: false };
    });
  }

  async reconcileBatch(
    batchId: string,
    actorId: string,
    dto: ReconcileCodBatchDto,
    tenantId = TenantContext.require(),
  ): Promise<{
    batch: CodSettlementBatchEntity;
    lines: CodSettlementLineEntity[];
  }> {
    return this.runInTenantTx(tenantId, async (em) =>
      this.reconcileBatchInTx(em, tenantId, actorId, batchId, dto),
    );
  }

  async reconcileBatchInTx(
    em: EntityManager,
    tenantId: string,
    actorId: string,
    batchId: string,
    dto: ReconcileCodBatchDto,
  ): Promise<{
    batch: CodSettlementBatchEntity;
    lines: CodSettlementLineEntity[];
  }> {
    const batchRepo = em.getRepository(CodSettlementBatchEntity);
    const lineRepo = em.getRepository(CodSettlementLineEntity);
    const arRepo = em.getRepository(CodReceivableEntity);
    const issueRepo = em.getRepository(ReconciliationIssueEntity);

    const batch = await batchRepo.findOne({
      where: { id: batchId, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!batch) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.COD_SETTLEMENT_NOT_FOUND,
        `COD settlement batch ${batchId} not found`,
        404,
      );
    }

    const lines = await lineRepo.find({
      where: { tenantId, batchId: batch.id },
      order: { lineNo: 'ASC' },
    });

    if (batch.status === 'RECONCILED' && batch.journalId) {
      return { batch, lines };
    }

    let totalExpectedVnd = 0;
    let totalDiscrepancyVnd = 0;
    let matchedExpectedVnd = 0;
    let matchedFeeVnd = 0;
    let matchedNetVnd = 0;
    let matchedCount = 0;
    let discrepancyCount = 0;

    for (const line of lines) {
      const receivable = await arRepo.findOne({
        where: {
          tenantId,
          carrierCode: batch.carrierCode,
          trackingNumber: line.trackingNumber,
        },
        lock: { mode: 'pessimistic_write' },
      });

      const reportedVnd = parseVnd(line.reportedCodAmount, {
        allowZero: true,
        field: 'reportedCodAmount',
      });
      const feeVnd = parseVnd(line.carrierFeeAmount, {
        allowZero: true,
        field: 'carrierFeeAmount',
      });
      const netVnd = parseVnd(line.netPayoutAmount, {
        allowZero: true,
        allowNegative: true,
        field: 'netPayoutAmount',
      });

      if (!receivable) {
        line.lineStatus = 'UNKNOWN_SHIPMENT';
        line.discrepancyAmount = reportedVnd;
        line.discrepancyReason = `No COD receivable found for trackingNumber ${line.trackingNumber}`;
        totalDiscrepancyVnd += reportedVnd;
        discrepancyCount += 1;
        await lineRepo.save(line);

        await issueRepo.save(
          issueRepo.create({
            id: randomUUID(),
            tenantId,
            runId: null,
            issueType: 'COD_UNKNOWN_SHIPMENT',
            severity: 'HIGH',
            sourceType: 'COD_SETTLEMENT_LINE',
            sourceId: line.id,
            expectedAmount: 0,
            actualAmount: line.reportedCodAmount,
            differenceAmount: line.reportedCodAmount,
            status: 'OPEN',
            description: line.discrepancyReason,
            resolutionNote: null,
            resolvedBy: null,
            resolvedAt: null,
          }),
        );
        continue;
      }

      const expectedVnd = parseVnd(receivable.expectedCodAmount, {
        allowZero: false,
        field: 'expectedCodAmount',
      });
      totalExpectedVnd += expectedVnd;
      line.codReceivableId = receivable.id;
      line.orderId = receivable.orderId;
      line.fulfillmentId = receivable.fulfillmentId;
      line.expectedCodAmount = receivable.expectedCodAmount;

      const evalResult = evaluateCodSettlementLine({
        expectedGrossCod: receivable.expectedCodAmount,
        reportedGrossCod: line.reportedCodAmount,
        carrierFee: line.carrierFeeAmount,
        reportedNetPayout: line.netPayoutAmount,
      });

      line.lineStatus = evalResult.status;
      line.discrepancyAmount = evalResult.discrepancyAmount;
      line.discrepancyReason = evalResult.discrepancyReason;
      await lineRepo.save(line);

      if (evalResult.status === 'DISCREPANCY') {
        discrepancyCount += 1;
        const diffVnd = parseVnd(evalResult.discrepancyAmount, {
          allowZero: true,
          allowNegative: true,
          field: 'discrepancyAmount',
        });
        totalDiscrepancyVnd += diffVnd < 0 ? -diffVnd : diffVnd;

        receivable.status = 'DISCREPANCY';
        receivable.reportedCollectedAmount = line.reportedCodAmount;
        receivable.carrierFeeAmount = line.carrierFeeAmount;
        receivable.expectedNetAmount = evalResult.expectedNetPayout;
        receivable.actualRemittedAmount = line.netPayoutAmount;
        receivable.discrepancyAmount = evalResult.discrepancyAmount;
        receivable.settlementBatchId = batch.id;
        receivable.version += 1;
        await arRepo.save(receivable);

        await issueRepo.save(
          issueRepo.create({
            id: randomUUID(),
            tenantId,
            runId: null,
            issueType: 'COD_SETTLEMENT_DISCREPANCY',
            severity: 'HIGH',
            sourceType: 'COD_RECEIVABLE',
            sourceId: receivable.id,
            expectedAmount: evalResult.expectedNetPayout,
            actualAmount: line.netPayoutAmount,
            differenceAmount: evalResult.discrepancyAmount,
            status: 'OPEN',
            description: `COD discrepancy on ${line.trackingNumber} (order ${receivable.orderId}): ${evalResult.discrepancyReason}`,
            resolutionNote: null,
            resolvedBy: null,
            resolvedAt: null,
          }),
        );
      } else {
        matchedCount += 1;
        matchedExpectedVnd += expectedVnd;
        matchedFeeVnd += feeVnd;
        matchedNetVnd += netVnd;

        receivable.status = 'RECONCILED';
        receivable.reportedCollectedAmount = line.reportedCodAmount;
        receivable.carrierFeeAmount = line.carrierFeeAmount;
        receivable.expectedNetAmount = evalResult.expectedNetPayout;
        receivable.actualRemittedAmount = line.netPayoutAmount;
        receivable.discrepancyAmount = 0;
        receivable.settlementBatchId = batch.id;
        receivable.reconciledAt = new Date();
        receivable.version += 1;
        await arRepo.save(receivable);
      }
    }

    let journalId: string | null = batch.journalId;
    let cashbookEntryId: string | null = batch.cashbookEntryId;

    if (matchedExpectedVnd > 0 && !journalId) {
      const targetCashAccountId = dto.cashAccountId ?? batch.cashAccountId;
      let cashAccount: CashAccountEntity | null = null;
      if (targetCashAccountId) {
        cashAccount = await em.getRepository(CashAccountEntity).findOne({
          where: { id: targetCashAccountId, tenantId },
        });
      } else {
        cashAccount =
          await this.cashAccountsService.ensureDefaultCashAccountInTx(
            em,
            tenantId,
            null,
            'BANK',
          );
      }

      const debitBankGl =
        cashAccount?.glAccountCode ?? GL_ACCOUNT_CODES.CASH_AT_BANK;

      const journalLines: Array<{
        accountCode: string;
        debitAmount?: number;
        creditAmount?: number;
        partyType?: 'CARRIER' | null;
        partyId?: string | null;
        memo?: string;
      }> = [
        {
          accountCode: debitBankGl,
          debitAmount: matchedNetVnd,
          partyType: 'CARRIER',
          partyId: batch.carrierCode,
          memo: `COD net bank remittance for batch ${batch.code}`,
        },
      ];

      if (matchedFeeVnd > 0) {
        journalLines.push({
          accountCode: GL_ACCOUNT_CODES.CARRIER_FEE_EXPENSE,
          debitAmount: matchedFeeVnd,
          partyType: 'CARRIER',
          partyId: batch.carrierCode,
          memo: `Carrier COD fee for batch ${batch.code}`,
        });
      }

      journalLines.push({
        accountCode: GL_ACCOUNT_CODES.COD_CARRIER_RECEIVABLE,
        creditAmount: matchedExpectedVnd,
        partyType: 'CARRIER',
        partyId: batch.carrierCode,
        memo: `Clear COD receivable for batch ${batch.code}`,
      });

      const postedJournal = await this.journalService.postJournalInTx(
        em,
        tenantId,
        {
          journalType: 'COD_SETTLEMENT',
          sourceType: 'COD_SETTLEMENT_BATCH',
          sourceId: batch.id,
          idempotencyKey: `codb-jnl:${batch.id}`,
          description: `COD settlement batch ${batch.code} (${batch.carrierCode} ${batch.statementRef})`,
          postedBy: actorId,
          lines: journalLines,
        },
      );
      journalId = postedJournal.journal.id;

      if (cashAccount && matchedNetVnd > 0) {
        const cbEntry =
          await this.cashbookService.createAndOptionallyPostVoucherInTx(
            em,
            tenantId,
            {
              actorId,
              direction: 'RECEIPT',
              cashAccountId: cashAccount.id,
              categoryCode: 'COD_SETTLEMENT_RECEIPT',
              amount: matchedNetVnd,
              voucherType: 'COD_SETTLEMENT',
              sourceType: 'COD_SETTLEMENT_BATCH',
              sourceId: batch.id,
              partyType: 'CARRIER',
              partyId: batch.carrierCode,
              description: `COD settlement net payout for batch ${batch.code}`,
              referenceDoc: batch.statementRef,
              autoPost: true,
              idempotencyKey: `codb-cb:${batch.id}`,
              skipJournalIfLinked: postedJournal.journal.id,
            },
          );
        cashbookEntryId = cbEntry.id;
      }
    }

    const now = new Date();
    batch.totalExpectedCod = totalExpectedVnd;
    batch.totalDiscrepancy = totalDiscrepancyVnd;
    batch.matchedCount = matchedCount;
    batch.discrepancyCount = discrepancyCount;
    batch.journalId = journalId;
    batch.cashbookEntryId = cashbookEntryId;
    batch.reconciledBy = actorId;
    batch.reconciledAt = now;
    batch.status =
      discrepancyCount === 0 ? 'RECONCILED' : 'DISCREPANCY_DETECTED';

    const savedBatch = await batchRepo.save(batch);

    const payload: FinanceCodSettlementEventPayload = {
      batchId: savedBatch.id,
      code: savedBatch.code,
      carrierCode: savedBatch.carrierCode,
      statementRef: savedBatch.statementRef,
      totalExpectedCod: savedBatch.totalExpectedCod,
      totalReportedCod: savedBatch.totalReportedCod,
      totalCarrierFee: savedBatch.totalCarrierFee,
      totalNetPayout: savedBatch.totalNetPayout,
      totalDiscrepancy: savedBatch.totalDiscrepancy,
      status: savedBatch.status,
      journalId: savedBatch.journalId,
      occurredAt: now.toISOString(),
    };

    await this.outbox.add(
      em,
      discrepancyCount > 0
        ? FINANCE_COD_DISCREPANCY_DETECTED
        : FINANCE_COD_SETTLEMENT_RECONCILED,
      payload,
      { tenantId },
    );

    return { batch: savedBatch, lines };
  }

  async listCodReceivables(
    query: ListCodReceivablesQueryDto,
    tenantId = TenantContext.require(),
    scope: BranchScope = null,
  ) {
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    return this.runInTenantTx(tenantId, async (em) => {
      const where: Record<string, unknown> = { tenantId };
      if (query.carrierCode) {
        where.carrierCode = query.carrierCode.trim().toUpperCase();
      }
      if (query.status) {
        where.status = query.status;
      }
      applyBranchScope(where, scope);
      const [items, total] = await em
        .getRepository(CodReceivableEntity)
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

  async listCodBatches(
    query: ListCodBatchesQueryDto,
    tenantId = TenantContext.require(),
  ) {
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    return this.runInTenantTx(tenantId, async (em) => {
      const where: Record<string, unknown> = { tenantId };
      if (query.carrierCode) {
        where.carrierCode = query.carrierCode.trim().toUpperCase();
      }
      if (query.status) {
        where.status = query.status;
      }
      const [items, total] = await em
        .getRepository(CodSettlementBatchEntity)
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

  async getCodBatchById(
    id: string,
    tenantId = TenantContext.require(),
  ): Promise<{
    batch: CodSettlementBatchEntity;
    lines: CodSettlementLineEntity[];
  }> {
    return this.runInTenantTx(tenantId, async (em) => {
      const batch = await em
        .getRepository(CodSettlementBatchEntity)
        .findOne({ where: { id, tenantId } });
      if (!batch) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.COD_SETTLEMENT_NOT_FOUND,
          `COD settlement batch ${id} not found`,
          404,
        );
      }
      const lines = await em.getRepository(CodSettlementLineEntity).find({
        where: { tenantId, batchId: batch.id },
        order: { lineNo: 'ASC' },
      });
      return { batch, lines };
    });
  }

  @OnEvent(SALES_FULFILLMENT_COMPLETED.type)
  async onSalesFulfillmentCompleted(
    envelope: EventEnvelope<{
      fulfillmentId: string;
      orderId: string;
      branchId?: string;
      carrierCode?: string;
      trackingNumber?: string;
      codAmount?: number;
    }>,
  ): Promise<void> {
    const { tenantId, payload } = envelope;
    if (
      !tenantId ||
      !payload?.orderId ||
      !payload?.trackingNumber ||
      !payload?.codAmount
    ) {
      return;
    }
    const cents = parseVnd(payload.codAmount, {
      allowZero: true,
      field: 'codAmount',
    });
    if (cents <= 0) {
      return;
    }
    await this.createCodReceivable(
      'event:sales.fulfillment.completed',
      `evt:cod:${payload.fulfillmentId ?? payload.trackingNumber}`,
      {
        orderId: payload.orderId,
        fulfillmentId: payload.fulfillmentId,
        branchId: payload.branchId,
        carrierCode: payload.carrierCode ?? 'DEFAULT_CARRIER',
        trackingNumber: payload.trackingNumber,
        expectedCodAmount: cents,
        idempotencyKey: `evt:cod:${payload.fulfillmentId ?? payload.trackingNumber}`,
      },
      tenantId,
    );
  }
}
