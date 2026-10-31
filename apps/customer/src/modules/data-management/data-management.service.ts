import { Injectable } from '@nestjs/common';
import {
  CUSTOMER_DEACTIVATED,
  CUSTOMER_MEMBERSHIP_CHANGED,
  CUSTOMER_UPDATED,
  CustomerLifecycleEventPayload,
  CustomerMembershipChangedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { DataSource, EntityManager } from 'typeorm';
import {
  CustomerDomainError,
  CustomerDomainErrorCode,
  maskPhoneNumber,
  normalizeEmail,
  normalizePhoneNumber,
  resolveEligibleMembershipTier,
  sanitizeCsvCell,
} from '../../domain/customer-domain';
import {
  getSchemaPrefix,
  nextCustomerDocumentCode,
} from '../../infrastructure/persistence/customer-code.generator';
import {
  CustomerAddressEntity,
  CustomerDataJobEntity,
  CustomerEntity,
  CustomerMergeHistoryEntity,
  LoyaltyAccountEntity,
  LoyaltyHoldEntity,
  LoyaltyTransactionEntity,
  MembershipTierEntity,
} from '../../infrastructure/persistence/customer.entities';
import {
  CreateExportJobDto,
  CreateImportJobDto,
  ImportCustomerRowDto,
  MergeCustomersDto,
} from './data-management.dto';

const MAX_IMPORT_ROWS = 2000;

@Injectable()
export class DataManagementService {
  constructor(
    private readonly dataSource: DataSource,
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

  async findDuplicates(tenantId: string) {
    return this.runInTenantTx(tenantId, async (em) => {
      const emailDuplicates: Array<{
        match_type: string;
        match_value: string;
        customer_ids: string[];
        count: string;
      }> = await em.query(
        `SELECT
           'EMAIL' AS "match_type",
           LOWER("email") AS "match_value",
           ARRAY_AGG("id" ORDER BY "created_at" ASC) AS "customer_ids",
           COUNT(*)::text AS "count"
         FROM ${this.schemaPrefix}"customers"
         WHERE "tenant_id" = $1
           AND "deleted_at" IS NULL
           AND "email" IS NOT NULL
         GROUP BY LOWER("email")
         HAVING COUNT(*) > 1`,
        [tenantId],
      );

      const nameDuplicates: Array<{
        match_type: string;
        match_value: string;
        customer_ids: string[];
        count: string;
      }> = await em.query(
        `SELECT
           'EXACT_NAME' AS "match_type",
           LOWER(TRIM("name")) AS "match_value",
           ARRAY_AGG("id" ORDER BY "created_at" ASC) AS "customer_ids",
           COUNT(*)::text AS "count"
         FROM ${this.schemaPrefix}"customers"
         WHERE "tenant_id" = $1
           AND "deleted_at" IS NULL
         GROUP BY LOWER(TRIM("name"))
         HAVING COUNT(*) > 1`,
        [tenantId],
      );

      const groups = [...emailDuplicates, ...nameDuplicates].map((row) => ({
        matchType: row.match_type,
        matchValue: row.match_value,
        customerIds: row.customer_ids,
        count: Number(row.count),
      }));

      return {
        items: groups,
        total: groups.length,
      };
    });
  }

  async mergeCustomers(
    tenantId: string,
    actorId: string,
    dto: MergeCustomersDto,
    headerIdempotencyKey?: string,
  ) {
    const { sourceCustomerId, targetCustomerId } = dto;
    if (sourceCustomerId === targetCustomerId) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.CUSTOMER_MERGE_CONFLICT,
        'Cannot merge a customer profile into itself',
        409,
      );
    }

    const idempotencyKey =
      headerIdempotencyKey?.trim() ||
      dto.idempotencyKey?.trim() ||
      `merge:${sourceCustomerId}:${targetCustomerId}`;

    return this.runInTenantTx(tenantId, async (em) => {
      // Check idempotent replay first
      const existingMerge = await em
        .getRepository(CustomerMergeHistoryEntity)
        .findOne({
          where: [
            { tenantId, idempotencyKey },
            { tenantId, sourceCustomerId },
          ],
        });

      if (existingMerge) {
        if (existingMerge.targetCustomerId === targetCustomerId) {
          return {
            idempotentReplay: true,
            mergeRecord: existingMerge,
          };
        }
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_MERGE_CONFLICT,
          `Source customer '${sourceCustomerId}' has already been merged into '${existingMerge.targetCustomerId}'`,
          409,
        );
      }

      // Lock both customers in deterministic UUID order to prevent deadlocks
      const sortedIds = [sourceCustomerId, targetCustomerId].sort();
      const lockedCustomers = await em
        .getRepository(CustomerEntity)
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.tenant_id = :tenantId AND c.id IN (:...sortedIds)', {
          tenantId,
          sortedIds,
        })
        .orderBy('c.id', 'ASC')
        .getMany();

      const sourceCustomer = lockedCustomers.find(
        (c) => c.id === sourceCustomerId,
      );
      const targetCustomer = lockedCustomers.find(
        (c) => c.id === targetCustomerId,
      );

      if (!sourceCustomer) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Source customer '${sourceCustomerId}' not found`,
          404,
        );
      }
      if (!targetCustomer) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Target customer '${targetCustomerId}' not found`,
          404,
        );
      }

      if (sourceCustomer.mergedIntoCustomerId) {
        if (sourceCustomer.mergedIntoCustomerId === targetCustomerId) {
          const hist = await em
            .getRepository(CustomerMergeHistoryEntity)
            .findOne({
              where: { tenantId, sourceCustomerId },
            });
          return {
            idempotentReplay: true,
            mergeRecord: hist,
          };
        }
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_MERGE_CONFLICT,
          `Source customer '${sourceCustomerId}' was already merged into '${sourceCustomer.mergedIntoCustomerId}'`,
          409,
        );
      }

      if (
        targetCustomer.status !== 'ACTIVE' ||
        targetCustomer.deletedAt !== null
      ) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_INACTIVE,
          `Target customer '${targetCustomerId}' must be ACTIVE to receive a merge`,
          409,
        );
      }

      // Check active HELD loyalty holds on source customer
      const activeSourceHolds = await em
        .getRepository(LoyaltyHoldEntity)
        .count({
          where: {
            tenantId,
            customerId: sourceCustomer.id,
            state: 'HELD',
          },
        });
      if (activeSourceHolds > 0) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.LOYALTY_STATE_CONFLICT,
          `Cannot merge source customer '${sourceCustomer.id}' while ${activeSourceHolds} loyalty hold(s) are active`,
          409,
        );
      }

      // Lock both loyalty accounts in deterministic customerId order
      const lockedAccounts = await em
        .getRepository(LoyaltyAccountEntity)
        .createQueryBuilder('la')
        .setLock('pessimistic_write')
        .where(
          'la.tenant_id = :tenantId AND la.customer_id IN (:...sortedIds)',
          { tenantId, sortedIds },
        )
        .orderBy('la.customer_id', 'ASC')
        .getMany();

      const sourceLoyalty = lockedAccounts.find(
        (la) => la.customerId === sourceCustomerId,
      );
      let targetLoyalty = lockedAccounts.find(
        (la) => la.customerId === targetCustomerId,
      );
      if (!targetLoyalty) {
        targetLoyalty = await em.getRepository(LoyaltyAccountEntity).save(
          em.getRepository(LoyaltyAccountEntity).create({
            tenantId,
            customerId: targetCustomer.id,
            postedPointsBalance: 0,
            heldPoints: 0,
            lifetimeEarnedPoints: 0,
            lifetimeRedeemedPoints: 0,
            qualifyingPoints: 0,
            tierId: targetCustomer.membershipTierId,
            status: 'ACTIVE',
            version: 1,
          }),
        );
      }

      let transferredPoints = 0;
      if (sourceLoyalty) {
        transferredPoints = sourceLoyalty.postedPointsBalance;
        if (transferredPoints !== 0) {
          const sourceBefore = sourceLoyalty.postedPointsBalance;
          const targetBefore = targetLoyalty.postedPointsBalance;
          const targetAfter = targetBefore + transferredPoints;

          sourceLoyalty.postedPointsBalance = 0;
          targetLoyalty.postedPointsBalance = targetAfter;

          const mergeOutTx = em.getRepository(LoyaltyTransactionEntity).create({
            tenantId,
            customerId: sourceCustomer.id,
            loyaltyAccountId: sourceLoyalty.id,
            transactionType: 'MERGE_OUT',
            pointsDelta: -transferredPoints,
            balanceBefore: sourceBefore,
            balanceAfter: 0,
            sourceType: 'CUSTOMER_MERGE',
            sourceRefId: targetCustomer.id,
            idempotencyKey: `merge:${idempotencyKey}:out`,
            actorId,
            reason:
              dto.reason ??
              `Merged loyalty balance into customer ${targetCustomer.code}`,
          });

          const mergeInTx = em.getRepository(LoyaltyTransactionEntity).create({
            tenantId,
            customerId: targetCustomer.id,
            loyaltyAccountId: targetLoyalty.id,
            transactionType: 'MERGE_IN',
            pointsDelta: transferredPoints,
            balanceBefore: targetBefore,
            balanceAfter: targetAfter,
            sourceType: 'CUSTOMER_MERGE',
            sourceRefId: sourceCustomer.id,
            idempotencyKey: `merge:${idempotencyKey}:in`,
            actorId,
            reason:
              dto.reason ??
              `Received loyalty balance from merged customer ${sourceCustomer.code}`,
          });

          await em
            .getRepository(LoyaltyTransactionEntity)
            .save([mergeOutTx, mergeInTx]);
        }

        targetLoyalty.lifetimeEarnedPoints +=
          sourceLoyalty.lifetimeEarnedPoints;
        targetLoyalty.lifetimeRedeemedPoints +=
          sourceLoyalty.lifetimeRedeemedPoints;
        targetLoyalty.qualifyingPoints += sourceLoyalty.qualifyingPoints;

        sourceLoyalty.qualifyingPoints = 0;
        sourceLoyalty.status = 'CLOSED';
        sourceLoyalty.version += 1;
        await em.getRepository(LoyaltyAccountEntity).save(sourceLoyalty);
      }

      // Re-evaluate membership tier for targetCustomer
      const tiers = await em.getRepository(MembershipTierEntity).find({
        where: { tenantId, status: 'ACTIVE' },
      });
      const newTier = resolveEligibleMembershipTier(
        targetLoyalty.qualifyingPoints,
        tiers,
      );
      const previousTierId = targetCustomer.membershipTierId;
      if (newTier && newTier.id !== targetCustomer.membershipTierId) {
        targetCustomer.membershipTierId = newTier.id;
        targetLoyalty.tierId = newTier.id;
      }

      targetLoyalty.version += 1;
      await em.getRepository(LoyaltyAccountEntity).save(targetLoyalty);

      // Move active addresses from source to target
      const targetHasDefault = await em
        .getRepository(CustomerAddressEntity)
        .count({
          where: {
            tenantId,
            customerId: targetCustomer.id,
            isDefault: true,
            status: 'ACTIVE',
          },
        });

      const sourceAddresses = await em
        .getRepository(CustomerAddressEntity)
        .find({
          where: {
            tenantId,
            customerId: sourceCustomer.id,
            status: 'ACTIVE',
          },
        });

      for (const addr of sourceAddresses) {
        addr.customerId = targetCustomer.id;
        if (targetHasDefault > 0 && addr.isDefault) {
          addr.isDefault = false;
        }
      }
      if (sourceAddresses.length > 0) {
        await em.getRepository(CustomerAddressEntity).save(sourceAddresses);
      }

      // Move purchase projections from source to target
      const movedProjectionsResult: Array<{ id: string }> = await em.query(
        `UPDATE ${this.schemaPrefix}"customer_purchase_projections"
         SET "customer_id" = $2,
             "updated_at" = now()
         WHERE "tenant_id" = $1 AND "customer_id" = $3
         RETURNING "id"`,
        [tenantId, targetCustomer.id, sourceCustomer.id],
      );

      // Inherit phone/email on target if target was missing them
      const sourcePhoneNorm = sourceCustomer.phoneNormalized;
      const sourcePhoneRaw = sourceCustomer.phone;
      const sourceEmail = sourceCustomer.email;

      // Deactivate source customer first and clear phone_normalized to avoid unique index collision
      sourceCustomer.status = 'INACTIVE';
      sourceCustomer.mergedIntoCustomerId = targetCustomer.id;
      sourceCustomer.phoneNormalized = null;
      sourceCustomer.deletedAt = new Date();
      sourceCustomer.version += 1;
      await em.getRepository(CustomerEntity).save(sourceCustomer);

      if (!targetCustomer.phoneNormalized && sourcePhoneNorm) {
        targetCustomer.phone = sourcePhoneRaw;
        targetCustomer.phoneNormalized = sourcePhoneNorm;
      }
      if (!targetCustomer.email && sourceEmail) {
        targetCustomer.email = sourceEmail;
      }
      targetCustomer.version += 1;
      await em.getRepository(CustomerEntity).save(targetCustomer);

      const mergeHistory = em.getRepository(CustomerMergeHistoryEntity).create({
        tenantId,
        sourceCustomerId: sourceCustomer.id,
        targetCustomerId: targetCustomer.id,
        idempotencyKey,
        transferredPoints,
        movedAddressesCount: sourceAddresses.length,
        movedOrdersCount: movedProjectionsResult.length,
        actorId,
        reason: dto.reason?.trim() ?? null,
      });
      const savedHistory = await em
        .getRepository(CustomerMergeHistoryEntity)
        .save(mergeHistory);

      const deactivatedPayload: CustomerLifecycleEventPayload = {
        customerId: sourceCustomer.id,
        code: sourceCustomer.code,
        status: 'INACTIVE',
        customerGroupId: sourceCustomer.customerGroupId,
        membershipTierId: sourceCustomer.membershipTierId,
        version: sourceCustomer.version,
        occurredAt: new Date().toISOString(),
      };
      await this.outbox.add(em, CUSTOMER_DEACTIVATED, deactivatedPayload, {
        tenantId,
      });

      if (newTier && previousTierId !== targetCustomer.membershipTierId) {
        const tierPayload: CustomerMembershipChangedPayload = {
          customerId: targetCustomer.id,
          previousTierId,
          newTierId: newTier.id,
          qualifyingPoints: targetLoyalty.qualifyingPoints,
          occurredAt: new Date().toISOString(),
        };
        await this.outbox.add(em, CUSTOMER_MEMBERSHIP_CHANGED, tierPayload, {
          tenantId,
        });
      }

      const updatedPayload: CustomerLifecycleEventPayload = {
        customerId: targetCustomer.id,
        code: targetCustomer.code,
        status: targetCustomer.status,
        customerGroupId: targetCustomer.customerGroupId,
        membershipTierId: targetCustomer.membershipTierId,
        version: targetCustomer.version,
        occurredAt: new Date().toISOString(),
      };
      await this.outbox.add(em, CUSTOMER_UPDATED, updatedPayload, { tenantId });

      return {
        idempotentReplay: false,
        mergeRecord: savedHistory,
        targetCustomer: {
          id: targetCustomer.id,
          code: targetCustomer.code,
          postedPointsBalance: targetLoyalty.postedPointsBalance,
          qualifyingPoints: targetLoyalty.qualifyingPoints,
          membershipTierId: targetCustomer.membershipTierId,
          version: targetCustomer.version,
        },
      };
    });
  }

  private parseCsvContent(csvContent: string): ImportCustomerRowDto[] {
    const lines = csvContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) {
      return [];
    }

    const headerCols = lines[0]
      .split(',')
      .map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    const hasHeader =
      headerCols.includes('name') ||
      headerCols.includes('phone') ||
      headerCols.includes('code');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines.map((line) => {
      const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      if (hasHeader) {
        const record: Record<string, string> = {};
        headerCols.forEach((col, idx) => {
          record[col] = cells[idx] ?? '';
        });
        return {
          code: record.code || undefined,
          name: record.name || '',
          phone: record.phone || undefined,
          email: record.email || undefined,
          source: record.source || 'IMPORT',
          note: record.note || undefined,
        };
      }
      return {
        code: cells[0] || undefined,
        name: cells[1] || '',
        phone: cells[2] || undefined,
        email: cells[3] || undefined,
        source: cells[4] || 'IMPORT',
        note: cells[5] || undefined,
      };
    });
  }

  async createImportJob(
    tenantId: string,
    actorId: string,
    dto: CreateImportJobDto,
  ) {
    const rows: ImportCustomerRowDto[] = dto.rows
      ? dto.rows
      : dto.csvContent
        ? this.parseCsvContent(dto.csvContent)
        : [];

    if (rows.length === 0) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.VALIDATION_ERROR,
        'Import job requires non-empty rows or csvContent',
        422,
      );
    }

    if (rows.length > MAX_IMPORT_ROWS) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.IMPORT_LIMIT_EXCEEDED,
        `Import job exceeds maximum of ${MAX_IMPORT_ROWS} rows (received ${rows.length})`,
        422,
      );
    }

    const conflictPolicy = dto.conflictPolicy ?? 'SKIP';

    return this.runInTenantTx(tenantId, async (em) => {
      const jobCode = await nextCustomerDocumentCode(em, tenantId, 'IMP');
      const tiers = await em.getRepository(MembershipTierEntity).find({
        where: { tenantId, status: 'ACTIVE' },
      });
      const defaultTier = resolveEligibleMembershipTier(0, tiers);

      let successRows = 0;
      let failedRows = 0;
      const errors: Array<{ row: number; error: string }> = [];

      for (let i = 0; i < rows.length; i += 1) {
        const rowNum = i + 1;
        const item = rows[i];
        try {
          const name = item.name?.trim();
          if (!name) {
            throw new CustomerDomainError(
              CustomerDomainErrorCode.VALIDATION_ERROR,
              'Row name is required',
              422,
            );
          }

          const phoneNormalized = normalizePhoneNumber(item.phone);
          const emailNormalized = normalizeEmail(item.email);

          let existing: CustomerEntity | null = null;
          if (phoneNormalized) {
            existing = await em.getRepository(CustomerEntity).findOne({
              where: { tenantId, phoneNormalized },
            });
            if (existing && existing.deletedAt !== null) {
              existing = null;
            }
          }
          if (!existing && item.code?.trim()) {
            existing = await em.getRepository(CustomerEntity).findOne({
              where: { tenantId, code: item.code.trim().toUpperCase() },
            });
          }

          if (existing) {
            if (conflictPolicy === 'UPDATE') {
              existing.name = name;
              if (emailNormalized !== null) {
                existing.email = emailNormalized;
              }
              if (item.note !== undefined) {
                existing.note = item.note?.trim() ?? null;
              }
              existing.version += 1;
              await em.getRepository(CustomerEntity).save(existing);
              successRows += 1;
              continue;
            } else {
              failedRows += 1;
              errors.push({
                row: rowNum,
                error: `Duplicate customer skipped (id=${existing.id})`,
              });
              continue;
            }
          }

          const code = item.code?.trim()
            ? item.code.trim().toUpperCase()
            : await nextCustomerDocumentCode(em, tenantId, 'KH');

          const customer = await em.getRepository(CustomerEntity).save(
            em.getRepository(CustomerEntity).create({
              tenantId,
              code,
              name,
              phone: item.phone?.trim() || phoneNormalized,
              phoneNormalized,
              email: emailNormalized,
              source: item.source?.trim().toUpperCase() || 'IMPORT',
              status: 'ACTIVE',
              membershipTierId: defaultTier?.id ?? null,
              debtLimit: 2000000,
              currentDebt: 0,
              note: item.note?.trim() ?? null,
              version: 1,
            }),
          );

          await em.getRepository(LoyaltyAccountEntity).save(
            em.getRepository(LoyaltyAccountEntity).create({
              tenantId,
              customerId: customer.id,
              postedPointsBalance: 0,
              heldPoints: 0,
              lifetimeEarnedPoints: 0,
              lifetimeRedeemedPoints: 0,
              qualifyingPoints: 0,
              tierId: defaultTier?.id ?? null,
              status: 'ACTIVE',
              version: 1,
            }),
          );

          successRows += 1;
        } catch (err) {
          failedRows += 1;
          errors.push({
            row: rowNum,
            error: err instanceof Error ? err.message : 'Invalid row data',
          });
        }
      }

      const job = em.getRepository(CustomerDataJobEntity).create({
        tenantId,
        code: jobCode,
        jobType: 'IMPORT',
        format: 'CSV',
        status: 'COMPLETED',
        totalRows: rows.length,
        successRows,
        failedRows,
        errorsJson: errors,
        resultCsv: null,
        createdBy: actorId,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        completedAt: new Date(),
      });

      return em.getRepository(CustomerDataJobEntity).save(job);
    });
  }

  async getImportJob(tenantId: string, jobId: string) {
    return this.runInTenantTx(tenantId, async (em) => {
      const job = await em.getRepository(CustomerDataJobEntity).findOne({
        where: { id: jobId, tenantId, jobType: 'IMPORT' },
      });
      if (!job) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Import job '${jobId}' not found`,
          404,
        );
      }
      return job;
    });
  }

  async createExportJob(
    tenantId: string,
    actorId: string,
    dto: CreateExportJobDto,
    fullPhone = false,
  ) {
    // Phones are unmasked only for a caller holding customers.update.
    const maskPhone = !fullPhone;

    return this.runInTenantTx(tenantId, async (em) => {
      const jobCode = await nextCustomerDocumentCode(em, tenantId, 'EXP');

      const qb = em
        .getRepository(CustomerEntity)
        .createQueryBuilder('c')
        .where('c.tenant_id = :tenantId', { tenantId });

      if (dto.status) {
        qb.andWhere('c.status = :status', { status: dto.status });
      } else {
        qb.andWhere('c.deleted_at IS NULL');
      }

      if (dto.customerGroupId) {
        qb.andWhere('c.customer_group_id = :customerGroupId', {
          customerGroupId: dto.customerGroupId,
        });
      }

      if (dto.membershipTierId) {
        qb.andWhere('c.membership_tier_id = :membershipTierId', {
          membershipTierId: dto.membershipTierId,
        });
      }

      qb.orderBy('c.created_at', 'DESC').take(5000);
      const customers = await qb.getMany();

      const header = 'code,name,phone,email,status,source,note';
      const csvLines = customers.map((c) => {
        const phoneVal = maskPhone
          ? (maskPhoneNumber(c.phoneNormalized ?? c.phone) ?? '')
          : (c.phoneNormalized ?? c.phone ?? '');
        const emailVal = c.email ?? '';
        const noteVal = c.note ?? '';
        return [
          sanitizeCsvCell(c.code),
          sanitizeCsvCell(c.name),
          sanitizeCsvCell(phoneVal),
          sanitizeCsvCell(emailVal),
          sanitizeCsvCell(c.status),
          sanitizeCsvCell(c.source),
          sanitizeCsvCell(noteVal),
        ].join(',');
      });

      const resultCsv = [header, ...csvLines].join('\n');

      const job = em.getRepository(CustomerDataJobEntity).create({
        tenantId,
        code: jobCode,
        jobType: 'EXPORT',
        format: 'CSV',
        status: 'COMPLETED',
        totalRows: customers.length,
        successRows: customers.length,
        failedRows: 0,
        errorsJson: [],
        resultCsv,
        createdBy: actorId,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        completedAt: new Date(),
      });

      return em.getRepository(CustomerDataJobEntity).save(job);
    });
  }

  async getExportJob(
    tenantId: string,
    jobId: string,
    actorId: string,
    fullPhone = false,
  ) {
    return this.runInTenantTx(tenantId, async (em) => {
      const job = await em.getRepository(CustomerDataJobEntity).findOne({
        where: { id: jobId, tenantId, jobType: 'EXPORT' },
      });
      // The stored CSV may hold full phones (created by a customers.update
      // holder): only its creator or another such holder may read it back.
      if (!job || (!fullPhone && job.createdBy !== actorId)) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Export job '${jobId}' not found`,
          404,
        );
      }
      return job;
    });
  }
}
