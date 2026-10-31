import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  FINANCE_CASHBOOK_ENTRY_POSTED,
  FinanceCashbookEntryPostedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  computePayloadHash,
  DEFAULT_CASHBOOK_CATEGORIES,
  FinanceDomainError,
  FinanceDomainErrorCode,
  GL_ACCOUNT_CODES,
  normalizeFinanceCode,
  parseVnd,
} from '../../domain/finance-domain';
import {
  getSchemaPrefix,
  nextFinanceDocumentCode,
} from '../../infrastructure/persistence/finance-code.generator';
import {
  CashAccountEntity,
  CashbookCategoryEntity,
  CashbookEntryEntity,
} from '../../infrastructure/persistence/finance.entities';
import { applyBranchScope, BranchScope } from '../../presentation/branch-scope';
import { FinancialJournalService } from '../financial-journal/financial-journal.service';
import {
  CreateCashbookCategoryDto,
  CreateCashbookVoucherDto,
  ListCashbookEntriesQueryDto,
  ReverseCashbookEntryDto,
} from './cashbook.dto';

@Injectable()
export class CashbookService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly journalService: FinancialJournalService,
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

  async ensureDefaultCategoriesInTx(
    em: EntityManager,
    tenantId: string,
  ): Promise<Map<string, CashbookCategoryEntity>> {
    const repo = em.getRepository(CashbookCategoryEntity);
    const existing = await repo.find({ where: { tenantId } });
    const byCode = new Map(existing.map((c) => [c.code, c]));

    for (const spec of DEFAULT_CASHBOOK_CATEGORIES) {
      if (!byCode.has(spec.code)) {
        await em.query(
          `INSERT INTO ${this.schemaPrefix}"cashbook_categories" (
             "id", "tenant_id", "code", "name", "direction", "gl_account_code", "is_system", "status"
           ) VALUES ($1, $2, $3, $4, $5, $6, true, 'ACTIVE')
           ON CONFLICT ("tenant_id", "code") DO NOTHING`,
          [
            randomUUID(),
            tenantId,
            spec.code,
            spec.name,
            spec.direction,
            spec.glAccountCode,
          ],
        );
      }
    }

    const all = await repo.find({ where: { tenantId } });
    return new Map(all.map((c) => [c.code, c]));
  }

  async createCategory(
    dto: CreateCashbookCategoryDto,
    tenantId = TenantContext.require(),
  ): Promise<CashbookCategoryEntity> {
    const code = normalizeFinanceCode(dto.code, 'category code');
    return this.runInTenantTx(tenantId, async (em) => {
      await this.ensureDefaultCategoriesInTx(em, tenantId);
      const repo = em.getRepository(CashbookCategoryEntity);
      const existing = await repo.findOne({ where: { tenantId, code } });
      if (existing) {
        return existing;
      }
      const defaultGl =
        dto.direction === 'RECEIPT'
          ? GL_ACCOUNT_CODES.OTHER_INCOME
          : GL_ACCOUNT_CODES.OPERATING_EXPENSE;
      const entity = repo.create({
        id: randomUUID(),
        tenantId,
        code,
        name: dto.name.trim(),
        direction: dto.direction,
        glAccountCode: dto.glAccountCode?.trim().toUpperCase() ?? defaultGl,
        isSystem: false,
        status: 'ACTIVE',
      });
      return repo.save(entity);
    });
  }

  async listCategories(
    direction?: 'RECEIPT' | 'EXPENSE',
    tenantId = TenantContext.require(),
  ): Promise<CashbookCategoryEntity[]> {
    return this.runInTenantTx(tenantId, async (em) => {
      await this.ensureDefaultCategoriesInTx(em, tenantId);
      const where: Record<string, unknown> = { tenantId };
      if (direction) {
        where.direction = direction;
      }
      return em.getRepository(CashbookCategoryEntity).find({
        where,
        order: { code: 'ASC' },
      });
    });
  }

  async createReceiptVoucher(
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: CreateCashbookVoucherDto,
    tenantId = TenantContext.require(),
    scope: BranchScope = null,
  ) {
    return this.createVoucher(
      tenantId,
      actorId,
      'RECEIPT',
      idempotencyKeyHeader,
      dto,
      scope,
    );
  }

  async createExpenseVoucher(
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: CreateCashbookVoucherDto,
    tenantId = TenantContext.require(),
    scope: BranchScope = null,
  ) {
    return this.createVoucher(
      tenantId,
      actorId,
      'EXPENSE',
      idempotencyKeyHeader,
      dto,
      scope,
    );
  }

  private async createVoucher(
    tenantId: string,
    actorId: string,
    direction: 'RECEIPT' | 'EXPENSE',
    idempotencyKeyHeader: string | undefined,
    dto: CreateCashbookVoucherDto,
    scope: BranchScope = null,
  ) {
    const amountVnd = parseVnd(dto.amount, {
      allowZero: false,
      allowNegative: false,
      field: 'amount',
    });
    const cleanKey =
      (idempotencyKeyHeader ?? dto.idempotencyKey ?? '').trim().toLowerCase() ||
      null;
    const reqHash = computePayloadHash({
      direction,
      cashAccountId: dto.cashAccountId,
      categoryId: dto.categoryId ?? null,
      categoryCode: dto.categoryCode ?? null,
      amount: amountVnd,
      branchId: dto.branchId ?? null,
      sourceType: dto.sourceType ?? null,
      sourceId: dto.sourceId ?? null,
    });

    return this.runInTenantTx(tenantId, async (em) => {
      if (scope) {
        // A restricted member may only book into a cash account of their branches.
        const account = await em
          .getRepository(CashAccountEntity)
          .findOne({ where: { id: dto.cashAccountId, tenantId } });
        if (
          account &&
          (!account.branchId || !scope.includes(account.branchId))
        ) {
          throw new FinanceDomainError(
            FinanceDomainErrorCode.CASH_ACCOUNT_NOT_FOUND,
            `Cash account ${dto.cashAccountId} not found`,
            404,
          );
        }
      }
      return this.createAndOptionallyPostVoucherInTx(em, tenantId, {
        actorId,
        direction,
        cashAccountId: dto.cashAccountId,
        categoryId: dto.categoryId,
        categoryCode: dto.categoryCode,
        amount: amountVnd,
        branchId: dto.branchId ?? null,
        shiftId: dto.shiftId ?? null,
        voucherType: dto.voucherType ?? 'MANUAL',
        sourceType: dto.sourceType ?? null,
        sourceId: dto.sourceId ?? null,
        partyType: dto.partyType ?? null,
        partyId: dto.partyId ?? null,
        description: dto.description ?? null,
        referenceDoc: dto.referenceDoc ?? null,
        autoPost: Boolean(dto.autoPost),
        idempotencyKey: cleanKey,
        requestHash: reqHash,
      });
    });
  }

  async createAndOptionallyPostVoucherInTx(
    em: EntityManager,
    tenantId: string,
    input: {
      actorId: string;
      direction: 'RECEIPT' | 'EXPENSE';
      cashAccountId: string;
      categoryId?: string;
      categoryCode?: string;
      amount: number;
      branchId?: string | null;
      shiftId?: string | null;
      voucherType?: string;
      sourceType?: string | null;
      sourceId?: string | null;
      partyType?: string | null;
      partyId?: string | null;
      description?: string | null;
      referenceDoc?: string | null;
      autoPost?: boolean;
      idempotencyKey?: string | null;
      requestHash?: string | null;
      skipJournalIfLinked?: string | null;
    },
  ): Promise<CashbookEntryEntity> {
    const entryRepo = em.getRepository(CashbookEntryEntity);

    if (input.idempotencyKey) {
      await em.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [tenantId, `cb-idem:${input.idempotencyKey}`],
      );
      const existing = await entryRepo.findOne({
        where: { tenantId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        if (
          input.requestHash &&
          existing.requestHash &&
          existing.requestHash !== input.requestHash
        ) {
          throw new FinanceDomainError(
            FinanceDomainErrorCode.IDEMPOTENCY_CONFLICT,
            `Cashbook idempotency key "${input.idempotencyKey}" was already used with a different payload`,
            409,
          );
        }
        if (input.autoPost && existing.status !== 'POSTED') {
          return this.postEntryInTx(
            em,
            tenantId,
            existing.id,
            input.actorId,
            input.idempotencyKey,
            input.skipJournalIfLinked,
          );
        }
        return existing;
      }
    }

    const account = await em.getRepository(CashAccountEntity).findOne({
      where: { id: input.cashAccountId, tenantId },
    });
    if (!account) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.CASH_ACCOUNT_NOT_FOUND,
        `Cash account ${input.cashAccountId} not found`,
        404,
      );
    }
    if (account.status !== 'ACTIVE') {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.CASH_ACCOUNT_INACTIVE,
        `Cash account ${account.code} is ${account.status} and cannot accept vouchers`,
        409,
      );
    }

    const catMap = await this.ensureDefaultCategoriesInTx(em, tenantId);
    let category: CashbookCategoryEntity | null = null;
    if (input.categoryId) {
      category = await em
        .getRepository(CashbookCategoryEntity)
        .findOne({ where: { id: input.categoryId, tenantId } });
    } else if (input.categoryCode) {
      category = catMap.get(input.categoryCode.trim().toUpperCase()) ?? null;
    } else {
      category =
        catMap.get(
          input.direction === 'RECEIPT' ? 'OTHER_RECEIPT' : 'OPERATING_EXPENSE',
        ) ?? null;
    }

    if (!category) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.CASHBOOK_CATEGORY_NOT_FOUND,
        'Cashbook category not found',
        404,
      );
    }
    if (category.direction !== input.direction) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.VALIDATION_ERROR,
        `Category ${category.code} (${category.direction}) cannot be used for a ${input.direction} voucher`,
        422,
      );
    }

    if (
      input.direction === 'EXPENSE' &&
      (!input.description || input.description.trim().length === 0)
    ) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.VALIDATION_ERROR,
        'Expense vouchers require a mandatory reason/description',
        422,
      );
    }

    const prefix = input.direction === 'RECEIPT' ? 'PT' : 'PC';
    const code = await nextFinanceDocumentCode(em, tenantId, prefix);
    const now = new Date();

    const entry = entryRepo.create({
      id: randomUUID(),
      tenantId,
      code,
      branchId: input.branchId ?? account.branchId ?? null,
      cashAccountId: account.id,
      categoryId: category.id,
      direction: input.direction,
      voucherType: input.voucherType ?? 'MANUAL',
      amount: input.amount,
      currency: 'VND',
      status: 'DRAFT',
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      partyType: input.partyType ?? null,
      partyId: input.partyId ?? null,
      shiftId: input.shiftId ?? null,
      journalId: null,
      reversalOfEntryId: null,
      reversedByEntryId: null,
      idempotencyKey: input.idempotencyKey ?? null,
      requestHash: input.requestHash ?? null,
      description: input.description ?? null,
      referenceDoc: input.referenceDoc ?? null,
      createdBy: input.actorId,
      approvedBy: null,
      postedBy: null,
      reversedBy: null,
      approvedAt: null,
      postedAt: null,
      reversedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await entryRepo.save(entry);

    if (input.autoPost) {
      return this.postEntryInTx(
        em,
        tenantId,
        entry.id,
        input.actorId,
        input.idempotencyKey ?? undefined,
        input.skipJournalIfLinked,
      );
    }

    return entry;
  }

  async approveEntry(
    entryId: string,
    actorId: string,
    tenantId = TenantContext.require(),
  ): Promise<CashbookEntryEntity> {
    return this.runInTenantTx(tenantId, async (em) => {
      const repo = em.getRepository(CashbookEntryEntity);
      const entry = await repo.findOne({
        where: { id: entryId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!entry) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CASHBOOK_ENTRY_NOT_FOUND,
          `Cashbook entry ${entryId} not found`,
          404,
        );
      }
      if (entry.status === 'APPROVED' || entry.status === 'POSTED') {
        return entry;
      }
      if (entry.status !== 'DRAFT') {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CASHBOOK_ENTRY_INVALID_STATE,
          `Cannot approve cashbook entry in status ${entry.status}`,
          409,
        );
      }
      entry.status = 'APPROVED';
      entry.approvedBy = actorId;
      entry.approvedAt = new Date();
      entry.version += 1;
      entry.updatedAt = new Date();
      return repo.save(entry);
    });
  }

  async postEntry(
    entryId: string,
    actorId: string,
    idempotencyKeyHeader?: string,
    tenantId = TenantContext.require(),
  ): Promise<CashbookEntryEntity> {
    return this.runInTenantTx(tenantId, async (em) => {
      return this.postEntryInTx(
        em,
        tenantId,
        entryId,
        actorId,
        idempotencyKeyHeader,
      );
    });
  }

  async postEntryInTx(
    em: EntityManager,
    tenantId: string,
    entryId: string,
    actorId: string,
    idempotencyKey?: string,
    preLinkedJournalId?: string | null,
  ): Promise<CashbookEntryEntity> {
    const entryRepo = em.getRepository(CashbookEntryEntity);
    const accountRepo = em.getRepository(CashAccountEntity);

    const entry = await entryRepo.findOne({
      where: { id: entryId, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!entry) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.CASHBOOK_ENTRY_NOT_FOUND,
        `Cashbook entry ${entryId} not found`,
        404,
      );
    }

    const cleanKey = idempotencyKey?.trim().toLowerCase() || null;

    if (entry.status === 'POSTED') {
      // Idempotent retry if the caller passes the matching idempotencyKey
      if (cleanKey && entry.idempotencyKey === cleanKey) {
        return entry;
      }
      throw new FinanceDomainError(
        FinanceDomainErrorCode.CASHBOOK_ENTRY_ALREADY_POSTED,
        `Cashbook entry ${entry.code} (${entry.id}) is already POSTED`,
        409,
      );
    }

    if (entry.status !== 'DRAFT' && entry.status !== 'APPROVED') {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.CASHBOOK_ENTRY_INVALID_STATE,
        `Cannot post cashbook entry in status ${entry.status}`,
        409,
      );
    }

    const account = await accountRepo.findOne({
      where: { id: entry.cashAccountId, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!account) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.CASH_ACCOUNT_NOT_FOUND,
        `Cash account ${entry.cashAccountId} not found`,
        404,
      );
    }
    if (account.status !== 'ACTIVE') {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.CASH_ACCOUNT_INACTIVE,
        `Cash account ${account.code} is ${account.status} and cannot accept postings`,
        409,
      );
    }

    const category = await em
      .getRepository(CashbookCategoryEntity)
      .findOne({ where: { id: entry.categoryId, tenantId } });
    const categoryGl =
      category?.glAccountCode ??
      (entry.direction === 'RECEIPT'
        ? GL_ACCOUNT_CODES.OTHER_INCOME
        : GL_ACCOUNT_CODES.OPERATING_EXPENSE);

    let journalId = preLinkedJournalId ?? null;
    if (!journalId) {
      const postedJournal = await this.journalService.postJournalInTx(
        em,
        tenantId,
        {
          journalType:
            entry.direction === 'RECEIPT'
              ? 'CASHBOOK_RECEIPT'
              : 'CASHBOOK_EXPENSE',
          sourceType: 'CASHBOOK_ENTRY',
          sourceId: entry.id,
          idempotencyKey: cleanKey ?? `cb-post:${entry.id}`,
          branchId: entry.branchId,
          description:
            entry.description ?? `${entry.direction} voucher ${entry.code}`,
          postedBy: actorId,
          lines:
            entry.direction === 'RECEIPT'
              ? [
                  {
                    accountCode: account.glAccountCode,
                    debitAmount: entry.amount,
                    branchId: entry.branchId,
                    memo: `Cash receipt ${entry.code}`,
                  },
                  {
                    accountCode: categoryGl,
                    creditAmount: entry.amount,
                    branchId: entry.branchId,
                    partyType: entry.partyType as
                      | 'CUSTOMER'
                      | 'SUPPLIER'
                      | 'CARRIER'
                      | null,
                    partyId: entry.partyId,
                    memo: entry.description ?? `Cash receipt ${entry.code}`,
                  },
                ]
              : [
                  {
                    accountCode: categoryGl,
                    debitAmount: entry.amount,
                    branchId: entry.branchId,
                    partyType: entry.partyType as
                      | 'CUSTOMER'
                      | 'SUPPLIER'
                      | 'CARRIER'
                      | null,
                    partyId: entry.partyId,
                    memo: entry.description ?? `Cash expense ${entry.code}`,
                  },
                  {
                    accountCode: account.glAccountCode,
                    creditAmount: entry.amount,
                    branchId: entry.branchId,
                    memo: `Cash expense ${entry.code}`,
                  },
                ],
        },
      );
      journalId = postedJournal.journal.id;
    }

    const curBalVnd = parseVnd(account.currentBalance, {
      allowZero: true,
      allowNegative: true,
      field: 'currentBalance',
    });
    const amtVnd = parseVnd(entry.amount, {
      allowZero: false,
      field: 'amount',
    });
    const newBalVnd =
      entry.direction === 'RECEIPT' ? curBalVnd + amtVnd : curBalVnd - amtVnd;

    account.currentBalance = newBalVnd;
    account.version += 1;
    account.updatedAt = new Date();
    await accountRepo.save(account);

    const now = new Date();
    entry.status = 'POSTED';
    entry.approvedBy = entry.approvedBy ?? actorId;
    entry.approvedAt = entry.approvedAt ?? now;
    entry.postedBy = actorId;
    entry.postedAt = now;
    entry.journalId = journalId;
    if (cleanKey && !entry.idempotencyKey) {
      entry.idempotencyKey = cleanKey;
    }
    entry.version += 1;
    entry.updatedAt = now;
    await entryRepo.save(entry);

    await this.outbox.add(
      em,
      FINANCE_CASHBOOK_ENTRY_POSTED,
      {
        entryId: entry.id,
        code: entry.code,
        branchId: entry.branchId,
        cashAccountId: entry.cashAccountId,
        categoryId: entry.categoryId,
        direction: entry.direction,
        voucherType: entry.voucherType,
        amount: entry.amount,
        currency: entry.currency,
        journalId,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        postedBy: actorId,
        occurredAt: now.toISOString(),
      } satisfies FinanceCashbookEntryPostedPayload,
      { tenantId },
    );

    return entry;
  }

  async reverseEntry(
    entryId: string,
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: ReverseCashbookEntryDto,
    tenantId = TenantContext.require(),
  ): Promise<CashbookEntryEntity> {
    const cleanKey =
      (idempotencyKeyHeader ?? dto.idempotencyKey ?? '').trim().toLowerCase() ||
      undefined;

    return this.runInTenantTx(tenantId, async (em) => {
      const entryRepo = em.getRepository(CashbookEntryEntity);
      const accountRepo = em.getRepository(CashAccountEntity);

      const orig = await entryRepo.findOne({
        where: { id: entryId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!orig) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CASHBOOK_ENTRY_NOT_FOUND,
          `Cashbook entry ${entryId} not found`,
          404,
        );
      }

      if (orig.status === 'REVERSED' && orig.reversedByEntryId) {
        if (cleanKey) {
          const revEntry = await entryRepo.findOne({
            where: { id: orig.reversedByEntryId, tenantId },
          });
          if (revEntry && revEntry.idempotencyKey === cleanKey) {
            return revEntry;
          }
        }
        throw new FinanceDomainError(
          FinanceDomainErrorCode.POSTING_ALREADY_REVERSED,
          `Cashbook entry ${orig.code} (${orig.id}) has already been reversed`,
          409,
          { entryId: orig.id, reversedByEntryId: orig.reversedByEntryId },
        );
      }

      if (orig.status !== 'POSTED') {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CASHBOOK_ENTRY_INVALID_STATE,
          `Only POSTED cashbook entries can be reversed (current status: ${orig.status})`,
          409,
        );
      }

      const account = await accountRepo.findOne({
        where: { id: orig.cashAccountId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CASH_ACCOUNT_NOT_FOUND,
          `Cash account ${orig.cashAccountId} not found`,
          404,
        );
      }

      let reversalJournalId: string | null = null;
      if (orig.journalId) {
        const revJournal = await this.journalService.reverseJournalInTx(
          em,
          tenantId,
          orig.journalId,
          actorId,
          dto.reason,
          cleanKey ? `${cleanKey}:jnl` : undefined,
        );
        reversalJournalId = revJournal.journal.id;
      }

      const oppositeDirection =
        orig.direction === 'RECEIPT' ? 'EXPENSE' : 'RECEIPT';
      const prefix = oppositeDirection === 'RECEIPT' ? 'PT' : 'PC';
      const revCode = await nextFinanceDocumentCode(em, tenantId, prefix);
      const now = new Date();

      const revEntry = entryRepo.create({
        id: randomUUID(),
        tenantId,
        code: revCode,
        branchId: orig.branchId,
        cashAccountId: orig.cashAccountId,
        categoryId: orig.categoryId,
        direction: oppositeDirection,
        voucherType: 'REVERSAL',
        amount: orig.amount,
        currency: orig.currency,
        status: 'POSTED',
        sourceType: 'CASHBOOK_REVERSAL',
        sourceId: orig.id,
        partyType: orig.partyType,
        partyId: orig.partyId,
        shiftId: orig.shiftId,
        journalId: reversalJournalId,
        reversalOfEntryId: orig.id,
        reversedByEntryId: null,
        idempotencyKey: cleanKey ?? `cb-rev:${orig.id}`,
        requestHash: null,
        description: `Reversal of ${orig.code}: ${dto.reason}`,
        referenceDoc: orig.code,
        createdBy: actorId,
        approvedBy: actorId,
        postedBy: actorId,
        reversedBy: null,
        approvedAt: now,
        postedAt: now,
        reversedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      await entryRepo.save(revEntry);

      orig.status = 'REVERSED';
      orig.reversedBy = actorId;
      orig.reversedAt = now;
      orig.reversedByEntryId = revEntry.id;
      orig.version += 1;
      orig.updatedAt = now;
      await entryRepo.save(orig);

      const curBalVnd = parseVnd(account.currentBalance, {
        allowZero: true,
        allowNegative: true,
        field: 'currentBalance',
      });
      const amtVnd = parseVnd(orig.amount, {
        allowZero: false,
        field: 'amount',
      });
      const restoredBalVnd =
        orig.direction === 'RECEIPT' ? curBalVnd - amtVnd : curBalVnd + amtVnd;

      account.currentBalance = restoredBalVnd;
      account.version += 1;
      account.updatedAt = now;
      await accountRepo.save(account);

      return revEntry;
    });
  }

  async getEntryById(
    entryId: string,
    tenantId = TenantContext.require(),
  ): Promise<CashbookEntryEntity> {
    return this.runInTenantTx(tenantId, async (em) => {
      const entry = await em
        .getRepository(CashbookEntryEntity)
        .findOne({ where: { id: entryId, tenantId } });
      if (!entry) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CASHBOOK_ENTRY_NOT_FOUND,
          `Cashbook entry ${entryId} not found`,
          404,
        );
      }
      return entry;
    });
  }

  async listEntries(
    query: ListCashbookEntriesQueryDto,
    tenantId = TenantContext.require(),
    scope: BranchScope = null,
  ) {
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    return this.runInTenantTx(tenantId, async (em) => {
      const where: Record<string, unknown> = { tenantId };
      if (query.branchId) {
        where.branchId = query.branchId;
      }
      applyBranchScope(where, scope);
      if (query.cashAccountId) {
        where.cashAccountId = query.cashAccountId;
      }
      if (query.categoryId) {
        where.categoryId = query.categoryId;
      }
      if (query.direction) {
        where.direction = query.direction;
      }
      if (query.status) {
        where.status = query.status;
      }
      if (query.sourceType) {
        where.sourceType = query.sourceType;
      }
      if (query.sourceId) {
        where.sourceId = query.sourceId;
      }

      const [items, total] = await em
        .getRepository(CashbookEntryEntity)
        .findAndCount({
          where,
          order: { createdAt: 'DESC', id: 'DESC' },
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

  async exportEntriesCsv(
    query: ListCashbookEntriesQueryDto,
    tenantId = TenantContext.require(),
    scope: BranchScope = null,
  ): Promise<{ filename: string; rowCount: number; csvContent: string }> {
    const res = await this.listEntries(
      { ...query, limit: '100', offset: '0' },
      tenantId,
      scope,
    );
    const header =
      'code,direction,voucherType,amount,currency,status,cashAccountId,categoryId,sourceType,sourceId,postedAt,createdAt';
    const rows = res.data.map((e) =>
      [
        e.code,
        e.direction,
        e.voucherType,
        e.amount,
        e.currency,
        e.status,
        e.cashAccountId,
        e.categoryId,
        e.sourceType ?? '',
        e.sourceId ?? '',
        e.postedAt ? e.postedAt.toISOString() : '',
        e.createdAt.toISOString(),
      ].join(','),
    );
    return {
      filename: `cashbook-export-${new Date().toISOString().slice(0, 10)}.csv`,
      rowCount: rows.length,
      csvContent: [header, ...rows].join('\n'),
    };
  }
}
