import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  FINANCE_CREDIT_AUTHORIZED,
  FINANCE_CREDIT_COMMITTED,
  FINANCE_CREDIT_RELEASED,
  FINANCE_RECEIVABLE_CREATED,
  FinanceCreditAuthorizationEventPayload,
  FinanceReceivableEventPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  computePayloadHash,
  DEFAULT_CUSTOMER_CREDIT_LIMIT_VND,
  evaluateCreditAuthorization,
  FinanceDomainError,
  FinanceDomainErrorCode,
  formatMoneyCents,
  GL_ACCOUNT_CODES,
  parseMoneyCents,
} from '../../domain/finance-domain';
import {
  getSchemaPrefix,
  nextFinanceDocumentCode,
} from '../../infrastructure/persistence/finance-code.generator';
import {
  CustomerCreditAuthorizationEntity,
  CustomerCreditProfileEntity,
  CustomerDebtLedgerEntity,
  CustomerReceivableEntity,
} from '../../infrastructure/persistence/finance.entities';
import { FinancialJournalService } from '../financial-journal/financial-journal.service';
import {
  CommitCreditAuthorizationDto,
  CreateCreditAuthorizationDto,
  ReleaseCreditAuthorizationDto,
  UpdateCustomerCreditLimitDto,
} from './credit-authorization.dto';

@Injectable()
export class CreditAuthorizationService {
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

  /**
   * Atomically ensures a CustomerCreditProfile row exists and locks it FOR UPDATE.
   * Safe under 100+ concurrent requests for the same customer.
   */
  async lockOrCreateProfileInTx(
    em: EntityManager,
    tenantId: string,
    customerId: string,
  ): Promise<CustomerCreditProfileEntity> {
    await em.query(
      `INSERT INTO ${this.schemaPrefix}"customer_credit_profiles" (
         "id", "tenant_id", "customer_id", "credit_limit", "posted_debt", "held_credit", "prepayment_balance", "status", "version"
       ) VALUES ($1, $2, $3, $4::numeric(18,2), 0.00, 0.00, 0.00, 'ACTIVE', 1)
       ON CONFLICT ("tenant_id", "customer_id") DO NOTHING`,
      [randomUUID(), tenantId, customerId, DEFAULT_CUSTOMER_CREDIT_LIMIT_VND],
    );

    const profile = await em
      .getRepository(CustomerCreditProfileEntity)
      .findOne({
        where: { tenantId, customerId },
        lock: { mode: 'pessimistic_write' },
      });
    return profile!;
  }

  private formatProfileResponse(profile: CustomerCreditProfileEntity) {
    const limitCents = parseMoneyCents(profile.creditLimit, {
      allowZero: true,
      field: 'creditLimit',
    });
    const postedCents = parseMoneyCents(profile.postedDebt, {
      allowZero: true,
      field: 'postedDebt',
    });
    const heldCents = parseMoneyCents(profile.heldCredit, {
      allowZero: true,
      field: 'heldCredit',
    });
    const availCents =
      limitCents > postedCents + heldCents
        ? limitCents - postedCents - heldCents
        : 0n;

    return {
      customerId: profile.customerId,
      tenantId: profile.tenantId,
      creditLimit: profile.creditLimit,
      postedDebt: profile.postedDebt,
      heldCredit: profile.heldCredit,
      availableCredit: formatMoneyCents(availCents),
      prepaymentBalance: profile.prepaymentBalance,
      status: profile.status,
      version: profile.version,
      updatedAt: profile.updatedAt,
    };
  }

  async getCreditProfile(
    customerId: string,
    tenantId = TenantContext.require(),
  ) {
    return this.runInTenantTx(tenantId, async (em) => {
      const profile = await this.lockOrCreateProfileInTx(
        em,
        tenantId,
        customerId,
      );
      return this.formatProfileResponse(profile);
    });
  }

  async updateCreditLimit(
    customerId: string,
    dto: UpdateCustomerCreditLimitDto,
    tenantId = TenantContext.require(),
  ) {
    const newLimitCents = parseMoneyCents(dto.creditLimit, {
      allowZero: true,
      field: 'creditLimit',
    });
    return this.runInTenantTx(tenantId, async (em) => {
      const profile = await this.lockOrCreateProfileInTx(
        em,
        tenantId,
        customerId,
      );
      profile.creditLimit = formatMoneyCents(newLimitCents);
      profile.version += 1;
      profile.updatedAt = new Date();
      await em.getRepository(CustomerCreditProfileEntity).save(profile);
      return this.formatProfileResponse(profile);
    });
  }

  async authorizeCredit(
    actorId: string,
    idempotencyKeyHeader: string | undefined,
    dto: CreateCreditAuthorizationDto,
    tenantId = TenantContext.require(),
  ) {
    const rawKey = (idempotencyKeyHeader ?? dto.idempotencyKey ?? '').trim();
    if (!rawKey) {
      throw new FinanceDomainError(
        FinanceDomainErrorCode.VALIDATION_ERROR,
        'Idempotency-Key header or idempotencyKey field is required for credit authorization',
        422,
      );
    }
    const idempotencyKey = rawKey.toLowerCase();
    const amountCents = parseMoneyCents(dto.amount, {
      allowZero: false,
      field: 'amount',
    });
    const amountStr = formatMoneyCents(amountCents);
    const requestHash = computePayloadHash({
      customerId: dto.customerId,
      amount: amountStr,
      orderId: dto.orderId ?? null,
      branchId: dto.branchId ?? null,
      overrideApprovedBy: dto.overrideApprovedBy ?? null,
    });

    return this.runInTenantTx(tenantId, async (em) => {
      const authRepo = em.getRepository(CustomerCreditAuthorizationEntity);
      const profileRepo = em.getRepository(CustomerCreditProfileEntity);

      // Step 1: Lock customer credit profile first so concurrent requests serialize cleanly
      const profile = await this.lockOrCreateProfileInTx(
        em,
        tenantId,
        dto.customerId,
      );

      // Step 2: Check idempotency key under lock
      const existing = await authRepo.findOne({
        where: { tenantId, idempotencyKey },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new FinanceDomainError(
            FinanceDomainErrorCode.IDEMPOTENCY_CONFLICT,
            `Credit authorization idempotency key "${idempotencyKey}" was already used with a different payload`,
            409,
          );
        }
        return {
          ...this.formatAuthorizationResponse(existing, profile),
          replayed: true,
        };
      }

      // Step 3: Evaluate credit limit invariant
      const evaluation = evaluateCreditAuthorization({
        creditLimit: profile.creditLimit,
        postedDebt: profile.postedDebt,
        heldCredit: profile.heldCredit,
        requestedAmount: amountStr,
        overrideApprovedBy: dto.overrideApprovedBy,
        overrideReason: dto.overrideReason,
      });

      const code = await nextFinanceDocumentCode(em, tenantId, 'CRD');
      const now = new Date();
      const ttlSeconds = dto.ttlSeconds ?? 900;
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

      profile.heldCredit = evaluation.heldCreditAfter;
      profile.version += 1;
      profile.updatedAt = now;
      await profileRepo.save(profile);

      const auth = authRepo.create({
        id: randomUUID(),
        tenantId,
        code,
        customerId: dto.customerId,
        orderId: dto.orderId ?? null,
        branchId: dto.branchId ?? null,
        authorizedAmount: amountStr,
        state: 'HELD',
        overrideApprovedBy: dto.overrideApprovedBy ?? null,
        overrideReason: dto.overrideReason ?? null,
        idempotencyKey,
        requestHash,
        callerService: dto.callerService ?? 'sales',
        expiresAt,
        committedReceivableId: null,
        releasedReason: null,
        createdBy: actorId,
        committedAt: null,
        releasedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      await authRepo.save(auth);

      await this.outbox.add(
        em,
        FINANCE_CREDIT_AUTHORIZED,
        {
          authorizationId: auth.id,
          code: auth.code,
          customerId: auth.customerId,
          orderId: auth.orderId,
          authorizedAmount: auth.authorizedAmount,
          state: 'HELD',
          postedDebtAfter: profile.postedDebt,
          heldCreditAfter: profile.heldCredit,
          availableCreditAfter: evaluation.availableCreditAfter,
          occurredAt: now.toISOString(),
        } satisfies FinanceCreditAuthorizationEventPayload,
        { tenantId },
      );

      return {
        ...this.formatAuthorizationResponse(auth, profile),
        replayed: false,
      };
    });
  }

  async getAuthorizationById(id: string, tenantId = TenantContext.require()) {
    return this.runInTenantTx(tenantId, async (em) => {
      const auth = await em
        .getRepository(CustomerCreditAuthorizationEntity)
        .findOne({ where: { id, tenantId } });
      if (!auth) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CREDIT_AUTHORIZATION_NOT_FOUND,
          `Credit authorization ${id} not found`,
          404,
        );
      }
      const profile = await this.lockOrCreateProfileInTx(
        em,
        tenantId,
        auth.customerId,
      );
      return this.formatAuthorizationResponse(auth, profile);
    });
  }

  async getAuthorizationByIdempotencyKey(
    idempotencyKey: string,
    tenantId = TenantContext.require(),
  ) {
    const cleanKey = idempotencyKey.trim().toLowerCase();
    return this.runInTenantTx(tenantId, async (em) => {
      const auth = await em
        .getRepository(CustomerCreditAuthorizationEntity)
        .findOne({ where: { tenantId, idempotencyKey: cleanKey } });
      if (!auth) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CREDIT_AUTHORIZATION_NOT_FOUND,
          `Credit authorization with key "${cleanKey}" not found`,
          404,
        );
      }
      const profile = await this.lockOrCreateProfileInTx(
        em,
        tenantId,
        auth.customerId,
      );
      return this.formatAuthorizationResponse(auth, profile);
    });
  }

  async commitAuthorization(
    authId: string,
    actorId: string,
    dto: CommitCreditAuthorizationDto,
    tenantId = TenantContext.require(),
  ) {
    return this.runInTenantTx(tenantId, async (em) => {
      const authRepo = em.getRepository(CustomerCreditAuthorizationEntity);
      const profileRepo = em.getRepository(CustomerCreditProfileEntity);
      const recRepo = em.getRepository(CustomerReceivableEntity);
      const ledgerRepo = em.getRepository(CustomerDebtLedgerEntity);

      const auth = await authRepo.findOne({
        where: { id: authId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!auth) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CREDIT_AUTHORIZATION_NOT_FOUND,
          `Credit authorization ${authId} not found`,
          404,
        );
      }

      const profile = await this.lockOrCreateProfileInTx(
        em,
        tenantId,
        auth.customerId,
      );

      if (auth.state === 'COMMITTED') {
        return {
          ...this.formatAuthorizationResponse(auth, profile),
          replayed: true,
        };
      }

      if (auth.state !== 'HELD') {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CREDIT_AUTHORIZATION_INVALID_STATE,
          `Cannot commit credit authorization ${auth.code} in state ${auth.state}`,
          409,
        );
      }

      const authCents = parseMoneyCents(auth.authorizedAmount, {
        allowZero: false,
        field: 'authorizedAmount',
      });
      const heldBeforeCents = parseMoneyCents(profile.heldCredit, {
        allowZero: true,
        field: 'heldCredit',
      });
      const postedBeforeCents = parseMoneyCents(profile.postedDebt, {
        allowZero: true,
        field: 'postedDebt',
      });

      const heldAfterCents =
        heldBeforeCents >= authCents ? heldBeforeCents - authCents : 0n;
      const postedAfterCents = postedBeforeCents + authCents;

      const orderId = dto.orderId ?? auth.orderId ?? null;
      const branchId = dto.branchId ?? auth.branchId ?? null;
      const effectiveActor = dto.actorId ?? actorId;

      // Post balanced double-entry journal: Debit AR (1310) / Credit Sales Revenue Clearing (5110)
      const postedJournal = await this.journalService.postJournalInTx(
        em,
        tenantId,
        {
          journalType: 'CREDIT_SALE_RECEIVABLE',
          sourceType: 'CREDIT_AUTHORIZATION_COMMIT',
          sourceId: auth.id,
          idempotencyKey: `crd-commit-jnl:${auth.id}`,
          branchId,
          description: `Credit sale receivable for authorization ${auth.code}`,
          postedBy: effectiveActor,
          lines: [
            {
              accountCode: GL_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
              debitAmount: auth.authorizedAmount,
              branchId,
              partyType: 'CUSTOMER',
              partyId: auth.customerId,
              memo: `Customer receivable from credit authorization ${auth.code}`,
            },
            {
              accountCode: GL_ACCOUNT_CODES.SALES_REVENUE_CLEARING,
              creditAmount: auth.authorizedAmount,
              branchId,
              partyType: 'CUSTOMER',
              partyId: auth.customerId,
              memo: `Credit sale clearing for ${auth.code}`,
            },
          ],
        },
      );

      const recCode = await nextFinanceDocumentCode(em, tenantId, 'AR');
      const now = new Date();
      const receivable = recRepo.create({
        id: randomUUID(),
        tenantId,
        code: recCode,
        customerId: auth.customerId,
        orderId,
        branchId,
        creditAuthorizationId: auth.id,
        originalAmount: auth.authorizedAmount,
        paidAmount: '0.00',
        adjustedAmount: '0.00',
        outstandingAmount: auth.authorizedAmount,
        currency: 'VND',
        status: 'OPEN',
        dueDate: new Date(now.getTime() + 30 * 86400 * 1000),
        sourceType: orderId ? 'SALES_ORDER' : 'CREDIT_AUTHORIZATION',
        sourceId: orderId ?? auth.id,
        journalId: postedJournal.journal.id,
        idempotencyKey: `ar-from-crd:${auth.id}`,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      await recRepo.save(receivable);

      const ledgerEntry = ledgerRepo.create({
        id: randomUUID(),
        tenantId,
        customerId: auth.customerId,
        receivableId: receivable.id,
        entryType: 'DEBT_RECOGNIZED',
        amountDelta: auth.authorizedAmount,
        balanceBefore: formatMoneyCents(postedBeforeCents),
        balanceAfter: formatMoneyCents(postedAfterCents),
        paymentMethod: 'CREDIT',
        cashbookEntryId: null,
        journalId: postedJournal.journal.id,
        referenceType: 'CREDIT_AUTHORIZATION',
        referenceId: auth.id,
        idempotencyKey: `ar-ldg-crd:${auth.id}`,
        note: `Committed credit hold ${auth.code}`,
        actorId: effectiveActor,
        occurredAt: now,
      });
      await ledgerRepo.save(ledgerEntry);

      profile.heldCredit = formatMoneyCents(heldAfterCents);
      profile.postedDebt = formatMoneyCents(postedAfterCents);
      profile.version += 1;
      profile.updatedAt = now;
      await profileRepo.save(profile);

      auth.state = 'COMMITTED';
      auth.orderId = orderId;
      auth.branchId = branchId;
      auth.committedReceivableId = receivable.id;
      auth.committedAt = now;
      auth.updatedAt = now;
      await authRepo.save(auth);

      const limitCents = parseMoneyCents(profile.creditLimit, {
        allowZero: true,
        field: 'creditLimit',
      });
      const availAfterCents =
        limitCents > postedAfterCents + heldAfterCents
          ? limitCents - postedAfterCents - heldAfterCents
          : 0n;

      await this.outbox.add(
        em,
        FINANCE_CREDIT_COMMITTED,
        {
          authorizationId: auth.id,
          code: auth.code,
          customerId: auth.customerId,
          orderId,
          authorizedAmount: auth.authorizedAmount,
          state: 'COMMITTED',
          postedDebtAfter: profile.postedDebt,
          heldCreditAfter: profile.heldCredit,
          availableCreditAfter: formatMoneyCents(availAfterCents),
          receivableId: receivable.id,
          occurredAt: now.toISOString(),
        } satisfies FinanceCreditAuthorizationEventPayload,
        { tenantId },
      );

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
        ...this.formatAuthorizationResponse(auth, profile),
        replayed: false,
      };
    });
  }

  async releaseAuthorization(
    authId: string,
    actorId: string,
    dto: ReleaseCreditAuthorizationDto,
    tenantId = TenantContext.require(),
  ) {
    return this.runInTenantTx(tenantId, async (em) => {
      const authRepo = em.getRepository(CustomerCreditAuthorizationEntity);
      const profileRepo = em.getRepository(CustomerCreditProfileEntity);

      const auth = await authRepo.findOne({
        where: { id: authId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!auth) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CREDIT_AUTHORIZATION_NOT_FOUND,
          `Credit authorization ${authId} not found`,
          404,
        );
      }

      const profile = await this.lockOrCreateProfileInTx(
        em,
        tenantId,
        auth.customerId,
      );

      if (auth.state === 'RELEASED' || auth.state === 'EXPIRED') {
        return {
          ...this.formatAuthorizationResponse(auth, profile),
          replayed: true,
        };
      }

      if (auth.state !== 'HELD') {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CREDIT_AUTHORIZATION_INVALID_STATE,
          `Cannot release credit authorization ${auth.code} in state ${auth.state}`,
          409,
        );
      }

      const authCents = parseMoneyCents(auth.authorizedAmount, {
        allowZero: false,
        field: 'authorizedAmount',
      });
      const heldBeforeCents = parseMoneyCents(profile.heldCredit, {
        allowZero: true,
        field: 'heldCredit',
      });
      const heldAfterCents =
        heldBeforeCents >= authCents ? heldBeforeCents - authCents : 0n;

      const now = new Date();
      profile.heldCredit = formatMoneyCents(heldAfterCents);
      profile.version += 1;
      profile.updatedAt = now;
      await profileRepo.save(profile);

      auth.state = 'RELEASED';
      auth.releasedReason =
        dto.reason ?? `Released by ${dto.actorId ?? actorId}`;
      auth.releasedAt = now;
      auth.updatedAt = now;
      await authRepo.save(auth);

      const limitCents = parseMoneyCents(profile.creditLimit, {
        allowZero: true,
        field: 'creditLimit',
      });
      const postedCents = parseMoneyCents(profile.postedDebt, {
        allowZero: true,
        field: 'postedDebt',
      });
      const availAfterCents =
        limitCents > postedCents + heldAfterCents
          ? limitCents - postedCents - heldAfterCents
          : 0n;

      await this.outbox.add(
        em,
        FINANCE_CREDIT_RELEASED,
        {
          authorizationId: auth.id,
          code: auth.code,
          customerId: auth.customerId,
          orderId: auth.orderId,
          authorizedAmount: auth.authorizedAmount,
          state: 'RELEASED',
          postedDebtAfter: profile.postedDebt,
          heldCreditAfter: profile.heldCredit,
          availableCreditAfter: formatMoneyCents(availAfterCents),
          occurredAt: now.toISOString(),
        } satisfies FinanceCreditAuthorizationEventPayload,
        { tenantId },
      );

      return {
        ...this.formatAuthorizationResponse(auth, profile),
        replayed: false,
      };
    });
  }

  async expireStaleAuthorizations(
    tenantId = TenantContext.require(),
  ): Promise<{ expiredCount: number }> {
    return this.runInTenantTx(tenantId, async (em) => {
      const overdue: CustomerCreditAuthorizationEntity[] = await em.query(
        `SELECT * FROM ${this.schemaPrefix}"customer_credit_authorizations"
         WHERE "tenant_id" = $1 AND "state" = 'HELD' AND "expires_at" <= now()
         FOR UPDATE SKIP LOCKED`,
        [tenantId],
      );

      let expiredCount = 0;
      for (const row of overdue) {
        const authId = String((row as unknown as Record<string, unknown>).id);
        const customerId = String(
          (row as unknown as Record<string, unknown>).customer_id,
        );
        const amountStr = String(
          (row as unknown as Record<string, unknown>).authorized_amount,
        );
        const profile = await this.lockOrCreateProfileInTx(
          em,
          tenantId,
          customerId,
        );
        const heldBefore = parseMoneyCents(profile.heldCredit, {
          allowZero: true,
          field: 'heldCredit',
        });
        const authCents = parseMoneyCents(amountStr, {
          allowZero: false,
          field: 'authorizedAmount',
        });
        const heldAfter = heldBefore >= authCents ? heldBefore - authCents : 0n;
        profile.heldCredit = formatMoneyCents(heldAfter);
        profile.version += 1;
        profile.updatedAt = new Date();
        await em.getRepository(CustomerCreditProfileEntity).save(profile);

        await em.query(
          `UPDATE ${this.schemaPrefix}"customer_credit_authorizations"
           SET "state" = 'EXPIRED', "released_reason" = 'TTL_EXPIRED', "released_at" = now(), "updated_at" = now()
           WHERE "tenant_id" = $1 AND "id" = $2`,
          [tenantId, authId],
        );
        expiredCount += 1;
      }

      return { expiredCount };
    });
  }

  private formatAuthorizationResponse(
    auth: CustomerCreditAuthorizationEntity,
    profile: CustomerCreditProfileEntity,
  ) {
    const limitCents = parseMoneyCents(profile.creditLimit, {
      allowZero: true,
      field: 'creditLimit',
    });
    const postedCents = parseMoneyCents(profile.postedDebt, {
      allowZero: true,
      field: 'postedDebt',
    });
    const heldCents = parseMoneyCents(profile.heldCredit, {
      allowZero: true,
      field: 'heldCredit',
    });
    const availCents =
      limitCents > postedCents + heldCents
        ? limitCents - postedCents - heldCents
        : 0n;

    return {
      authorizationId: auth.id,
      code: auth.code,
      tenantId: auth.tenantId,
      customerId: auth.customerId,
      orderId: auth.orderId,
      branchId: auth.branchId,
      authorizedAmount: auth.authorizedAmount,
      state: auth.state,
      overrideApprovedBy: auth.overrideApprovedBy,
      overrideReason: auth.overrideReason,
      idempotencyKey: auth.idempotencyKey,
      committedReceivableId: auth.committedReceivableId,
      expiresAt: auth.expiresAt,
      committedAt: auth.committedAt,
      releasedAt: auth.releasedAt,
      creditSummary: {
        creditLimit: profile.creditLimit,
        postedDebt: profile.postedDebt,
        heldCredit: profile.heldCredit,
        availableCredit: formatMoneyCents(availCents),
      },
    };
  }
}
