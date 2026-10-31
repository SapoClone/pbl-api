import { Injectable } from '@nestjs/common';
import { RequestContext, TenantContext } from '@pbl/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  DEFAULT_FINANCE_ACCOUNTS,
  FinanceDomainError,
  FinanceDomainErrorCode,
  JournalLineInput,
  normalizeFinanceCode,
  validateBalancedJournalLines,
} from '../../domain/finance-domain';
import {
  getSchemaPrefix,
  nextFinanceDocumentCode,
} from '../../infrastructure/persistence/finance-code.generator';
import {
  FinancialAccountEntity,
  FinancialJournalEntity,
  FinancialJournalLineEntity,
} from '../../infrastructure/persistence/finance.entities';
import { applyBranchScope, BranchScope } from '../../presentation/branch-scope';
import {
  CreateFinancialAccountDto,
  ListJournalsQueryDto,
  PostJournalDto,
  ReverseJournalDto,
} from './financial-journal.dto';

export interface PostJournalInTxInput {
  journalType: string;
  sourceType: string;
  sourceId: string;
  idempotencyKey?: string;
  branchId?: string | null;
  description?: string | null;
  effectiveDate?: Date;
  postedBy: string;
  correlationId?: string | null;
  reversalOfJournalId?: string | null;
  lines: JournalLineInput[];
}

export interface PostedJournalWithLines {
  journal: FinancialJournalEntity;
  lines: FinancialJournalLineEntity[];
  replayed: boolean;
}

@Injectable()
export class FinancialJournalService {
  constructor(private readonly dataSource: DataSource) {}

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

  /**
   * Idempotently ensures the 13 standard internal GL accounts exist for a tenant.
   */
  async ensureDefaultAccountsInTx(
    em: EntityManager,
    tenantId: string,
  ): Promise<Map<string, FinancialAccountEntity>> {
    const repo = em.getRepository(FinancialAccountEntity);
    const existing = await repo.find({ where: { tenantId } });
    const byCode = new Map(existing.map((a) => [a.code, a]));

    for (const spec of DEFAULT_FINANCE_ACCOUNTS) {
      if (!byCode.has(spec.code)) {
        await em.query(
          `INSERT INTO ${this.schemaPrefix}"financial_accounts" (
             "id", "tenant_id", "code", "name", "account_type", "normal_side", "currency", "is_system", "status"
           ) VALUES ($1, $2, $3, $4, $5, $6, 'VND', true, 'ACTIVE')
           ON CONFLICT ("tenant_id", "code") DO NOTHING`,
          [
            randomUUID(),
            tenantId,
            spec.code,
            spec.name,
            spec.accountType,
            spec.normalSide,
          ],
        );
      }
    }

    const all = await repo.find({ where: { tenantId } });
    return new Map(all.map((a) => [a.code, a]));
  }

  async createAccount(
    dto: CreateFinancialAccountDto,
    tenantId = TenantContext.require(),
  ): Promise<FinancialAccountEntity> {
    const code = normalizeFinanceCode(dto.code, 'account code');
    return this.runInTenantTx(tenantId, async (em) => {
      await this.ensureDefaultAccountsInTx(em, tenantId);
      const repo = em.getRepository(FinancialAccountEntity);
      const dup = await repo.findOne({ where: { tenantId, code } });
      if (dup) {
        return dup;
      }
      const entity = repo.create({
        id: randomUUID(),
        tenantId,
        code,
        name: dto.name.trim(),
        accountType: dto.accountType,
        normalSide: dto.normalSide,
        currency: 'VND',
        isSystem: false,
        status: 'ACTIVE',
      });
      return repo.save(entity);
    });
  }

  async listAccounts(
    tenantId = TenantContext.require(),
  ): Promise<FinancialAccountEntity[]> {
    return this.runInTenantTx(tenantId, async (em) => {
      await this.ensureDefaultAccountsInTx(em, tenantId);
      return em.getRepository(FinancialAccountEntity).find({
        where: { tenantId },
        order: { code: 'ASC' },
      });
    });
  }

  /**
   * Posts a balanced double-entry journal within an active EntityManager transaction.
   * Deduplicates by (tenantId, sourceType, sourceId) and (tenantId, idempotencyKey).
   */
  async postJournalInTx(
    em: EntityManager,
    tenantId: string,
    input: PostJournalInTxInput,
  ): Promise<PostedJournalWithLines> {
    const validated = validateBalancedJournalLines(input.lines);
    const sourceType = input.sourceType.trim().toUpperCase();
    const sourceId = input.sourceId.trim();
    const idempotencyKey = (
      input.idempotencyKey ?? `jnl:${sourceType}:${sourceId}`
    )
      .trim()
      .toLowerCase();

    const journalRepo = em.getRepository(FinancialJournalEntity);
    const lineRepo = em.getRepository(FinancialJournalLineEntity);

    // Check existing by source or idempotencyKey
    const existing = await journalRepo.findOne({
      where: [
        { tenantId, sourceType, sourceId },
        { tenantId, idempotencyKey },
      ],
    });
    if (existing) {
      if (
        existing.totalDebit !== validated.totalDebit ||
        existing.sourceType !== sourceType ||
        existing.sourceId !== sourceId
      ) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.IDEMPOTENCY_CONFLICT,
          `Journal idempotency key "${idempotencyKey}" or source "${sourceType}:${sourceId}" was already posted with different parameters`,
          409,
          { existingJournalId: existing.id, code: existing.code },
        );
      }
      const existingLines = await lineRepo.find({
        where: { tenantId, journalId: existing.id },
        order: { lineNo: 'ASC' },
      });
      return {
        journal: existing,
        lines: existingLines,
        replayed: true,
      };
    }

    const accountMap = await this.ensureDefaultAccountsInTx(em, tenantId);

    // Verify all referenced accounts exist and are ACTIVE
    for (const line of validated.lines) {
      const acc = accountMap.get(line.accountCode);
      if (!acc) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.FINANCIAL_ACCOUNT_NOT_FOUND,
          `Financial account "${line.accountCode}" not found`,
          404,
        );
      }
      if (acc.status !== 'ACTIVE') {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.FINANCIAL_ACCOUNT_INACTIVE,
          `Financial account "${line.accountCode}" is INACTIVE`,
          409,
        );
      }
    }

    const journalId = randomUUID();
    const code = await nextFinanceDocumentCode(em, tenantId, 'JNL');
    const now = new Date();

    const journal = journalRepo.create({
      id: journalId,
      tenantId,
      code,
      journalType: input.journalType.trim().toUpperCase(),
      sourceType,
      sourceId,
      idempotencyKey,
      branchId: input.branchId ?? null,
      currency: 'VND',
      totalDebit: validated.totalDebit,
      totalCredit: validated.totalCredit,
      status: 'POSTED',
      reversalOfJournalId: input.reversalOfJournalId ?? null,
      reversedByJournalId: null,
      description: input.description ?? null,
      effectiveDate: input.effectiveDate ?? now,
      postedBy: input.postedBy,
      correlationId:
        input.correlationId ?? RequestContext.get()?.requestId ?? null,
      postedAt: now,
      createdAt: now,
    });
    await journalRepo.save(journal);

    const lineEntities = validated.lines.map((line) => {
      const acc = accountMap.get(line.accountCode)!;
      return lineRepo.create({
        id: randomUUID(),
        tenantId,
        journalId,
        lineNo: line.lineNo,
        accountId: acc.id,
        accountCode: acc.code,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
        branchId: line.branchId,
        partyType: line.partyType,
        partyId: line.partyId,
        referenceType: line.referenceType ?? sourceType,
        referenceId: line.referenceId ?? sourceId,
        memo: line.memo ?? input.description ?? null,
        createdAt: now,
      });
    });
    await lineRepo.save(lineEntities);

    return {
      journal,
      lines: lineEntities,
      replayed: false,
    };
  }

  /**
   * Reverses an existing posted journal within an active EntityManager transaction.
   * Locks original journal FOR UPDATE to prevent concurrent double-reversal.
   */
  async reverseJournalInTx(
    em: EntityManager,
    tenantId: string,
    journalId: string,
    actorId: string,
    reason: string,
    idempotencyKey?: string,
  ): Promise<PostedJournalWithLines> {
    const journalRepo = em.getRepository(FinancialJournalEntity);
    const lineRepo = em.getRepository(FinancialJournalLineEntity);

    const orig = await journalRepo.findOne({
      where: { id: journalId, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!orig) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.JOURNAL_NOT_FOUND,
        `Financial journal ${journalId} not found`,
        404,
      );
    }

    if (orig.status === 'REVERSED' && orig.reversedByJournalId) {
      if (idempotencyKey) {
        const revJournal = await journalRepo.findOne({
          where: { id: orig.reversedByJournalId, tenantId },
        });
        if (
          revJournal &&
          revJournal.idempotencyKey === idempotencyKey.trim().toLowerCase()
        ) {
          const revLines = await lineRepo.find({
            where: { tenantId, journalId: revJournal.id },
            order: { lineNo: 'ASC' },
          });
          return { journal: revJournal, lines: revLines, replayed: true };
        }
      }
      throw new FinanceDomainError(
        FinanceDomainErrorCode.POSTING_ALREADY_REVERSED,
        `Journal ${orig.code} (${orig.id}) has already been reversed`,
        409,
        {
          journalId: orig.id,
          reversedByJournalId: orig.reversedByJournalId,
        },
      );
    }

    const origLines = await lineRepo.find({
      where: { tenantId, journalId: orig.id },
      order: { lineNo: 'ASC' },
    });

    const reversalLines: JournalLineInput[] = origLines.map((l) => ({
      accountCode: l.accountCode,
      debitAmount: l.creditAmount,
      creditAmount: l.debitAmount,
      branchId: l.branchId,
      partyType: l.partyType as 'CUSTOMER' | 'SUPPLIER' | 'CARRIER' | null,
      partyId: l.partyId,
      referenceType: 'JOURNAL_REVERSAL',
      referenceId: orig.id,
      memo: `Reversal of ${orig.code}: ${reason}`,
    }));

    const postedReversal = await this.postJournalInTx(em, tenantId, {
      journalType: `${orig.journalType}_REVERSAL`,
      sourceType: 'JOURNAL_REVERSAL',
      sourceId: orig.id,
      idempotencyKey: idempotencyKey ?? `jnl-rev:${tenantId}:${orig.id}`,
      branchId: orig.branchId,
      description: `Reversal of ${orig.code}: ${reason}`,
      postedBy: actorId,
      reversalOfJournalId: orig.id,
      lines: reversalLines,
    });

    await em.query(
      `UPDATE ${this.schemaPrefix}"financial_journals"
       SET "status" = 'REVERSED',
           "reversed_by_journal_id" = $3
       WHERE "tenant_id" = $1 AND "id" = $2`,
      [tenantId, orig.id, postedReversal.journal.id],
    );

    return postedReversal;
  }

  async postManualJournal(
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: PostJournalDto,
    tenantId = TenantContext.require(),
  ): Promise<PostedJournalWithLines> {
    return this.runInTenantTx(tenantId, async (em) => {
      return this.postJournalInTx(em, tenantId, {
        journalType: dto.journalType,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
        idempotencyKey: idempotencyKeyHeader ?? dto.idempotencyKey,
        branchId: dto.branchId ?? null,
        description: dto.description ?? null,
        postedBy: actorId,
        lines: dto.lines,
      });
    });
  }

  async reverseJournal(
    journalId: string,
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: ReverseJournalDto,
    tenantId = TenantContext.require(),
  ): Promise<PostedJournalWithLines> {
    return this.runInTenantTx(tenantId, async (em) => {
      return this.reverseJournalInTx(
        em,
        tenantId,
        journalId,
        actorId,
        dto.reason,
        idempotencyKeyHeader ?? dto.idempotencyKey,
      );
    });
  }

  async getJournalById(journalId: string, tenantId = TenantContext.require()) {
    return this.runInTenantTx(tenantId, async (em) => {
      const journal = await em
        .getRepository(FinancialJournalEntity)
        .findOne({ where: { id: journalId, tenantId } });
      if (!journal) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.JOURNAL_NOT_FOUND,
          `Financial journal ${journalId} not found`,
          404,
        );
      }
      const lines = await em.getRepository(FinancialJournalLineEntity).find({
        where: { tenantId, journalId: journal.id },
        order: { lineNo: 'ASC' },
      });
      return { ...journal, lines };
    });
  }

  async listJournals(
    query: ListJournalsQueryDto,
    tenantId = TenantContext.require(),
    scope: BranchScope = null,
  ) {
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    return this.runInTenantTx(tenantId, async (em) => {
      const where: Record<string, unknown> = { tenantId };
      if (query.journalType) {
        where.journalType = query.journalType.trim().toUpperCase();
      }
      if (query.sourceType) {
        where.sourceType = query.sourceType.trim().toUpperCase();
      }
      if (query.sourceId) {
        where.sourceId = query.sourceId.trim();
      }
      if (query.branchId) {
        where.branchId = query.branchId;
      }
      applyBranchScope(where, scope);
      if (query.status) {
        where.status = query.status;
      }

      const [items, total] = await em
        .getRepository(FinancialJournalEntity)
        .findAndCount({
          where,
          order: { postedAt: 'DESC', id: 'DESC' },
          take: limit,
          skip: offset,
        });

      return {
        data: items,
        pagination: {
          limit,
          offset,
          total,
        },
      };
    });
  }
}
