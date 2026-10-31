import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  FinanceDomainError,
  FinanceDomainErrorCode,
  GL_ACCOUNT_CODES,
  maskBankAccountNumber,
  normalizeFinanceCode,
  parseVnd,
} from '../../domain/finance-domain';
import { getSchemaPrefix } from '../../infrastructure/persistence/finance-code.generator';
import {
  CashAccountEntity,
  CashbookEntryEntity,
} from '../../infrastructure/persistence/finance.entities';
import { applyBranchScope, BranchScope } from '../../presentation/branch-scope';
import {
  CreateCashAccountDto,
  ListCashAccountsQueryDto,
  UpdateCashAccountDto,
} from './cash-accounts.dto';

@Injectable()
export class CashAccountsService {
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
   * Ensures at least one active CashAccount exists for the tenant (and branch if provided).
   */
  async ensureDefaultCashAccountInTx(
    em: EntityManager,
    tenantId: string,
    branchId?: string | null,
    accountType: 'CASH_DRAWER' | 'BANK' = 'CASH_DRAWER',
  ): Promise<CashAccountEntity> {
    const repo = em.getRepository(CashAccountEntity);
    if (branchId && accountType === 'CASH_DRAWER') {
      const branchAcc = await repo.findOne({
        where: {
          tenantId,
          branchId,
          accountType: 'CASH_DRAWER',
          status: 'ACTIVE',
        },
        order: { createdAt: 'ASC' },
      });
      if (branchAcc) {
        return branchAcc;
      }
    }

    const anyActive = await repo.findOne({
      where: { tenantId, accountType, status: 'ACTIVE' },
      order: { createdAt: 'ASC' },
    });
    if (anyActive) {
      return anyActive;
    }

    const defaultCode = accountType === 'BANK' ? 'BANK-MAIN' : 'CASH-MAIN';
    const defaultName =
      accountType === 'BANK'
        ? 'Main Company Bank Account'
        : 'Main Store Cash Drawer';
    const glAccountCode =
      accountType === 'BANK'
        ? GL_ACCOUNT_CODES.CASH_AT_BANK
        : GL_ACCOUNT_CODES.CASH_ON_HAND;

    await em.query(
      `INSERT INTO ${this.schemaPrefix}"cash_accounts" (
         "id", "tenant_id", "branch_id", "code", "name", "account_type", "currency", "gl_account_code", "current_balance", "status"
       ) VALUES ($1, $2, $3, $4, $5, $6, 'VND', $7, 0, 'ACTIVE')
       ON CONFLICT ("tenant_id", "code") DO NOTHING`,
      [
        randomUUID(),
        tenantId,
        branchId ?? null,
        defaultCode,
        defaultName,
        accountType,
        glAccountCode,
      ],
    );

    const created = await repo.findOne({
      where: { tenantId, code: defaultCode },
    });
    return created!;
  }

  async createCashAccount(
    dto: CreateCashAccountDto,
    tenantId = TenantContext.require(),
  ): Promise<CashAccountEntity> {
    const code = normalizeFinanceCode(dto.code, 'cash account code');
    const accountType = dto.accountType ?? 'CASH_DRAWER';
    const glAccountCode =
      accountType === 'BANK' || accountType === 'E_WALLET'
        ? GL_ACCOUNT_CODES.CASH_AT_BANK
        : GL_ACCOUNT_CODES.CASH_ON_HAND;

    return this.runInTenantTx(tenantId, async (em) => {
      const repo = em.getRepository(CashAccountEntity);
      const existing = await repo.findOne({ where: { tenantId, code } });
      if (existing) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CASH_ACCOUNT_CODE_CONFLICT,
          `Cash account code "${code}" already exists`,
          409,
        );
      }

      const entity = repo.create({
        id: randomUUID(),
        tenantId,
        branchId: dto.branchId ?? null,
        code,
        name: dto.name.trim(),
        accountType,
        currency: 'VND',
        glAccountCode,
        currentBalance: 0,
        status: 'ACTIVE',
        bankName: dto.bankName?.trim() ?? null,
        maskedAccountNumber: maskBankAccountNumber(dto.accountNumber),
        version: 1,
      });
      return repo.save(entity);
    });
  }

  async listCashAccounts(
    query: ListCashAccountsQueryDto,
    tenantId = TenantContext.require(),
    scope: BranchScope = null,
  ): Promise<CashAccountEntity[]> {
    return this.runInTenantTx(tenantId, async (em) => {
      const where: Record<string, unknown> = { tenantId };
      if (query.branchId) {
        where.branchId = query.branchId;
      }
      applyBranchScope(where, scope);
      if (query.status) {
        where.status = query.status;
      }
      if (query.accountType) {
        where.accountType = query.accountType;
      }
      return em.getRepository(CashAccountEntity).find({
        where,
        order: { code: 'ASC' },
      });
    });
  }

  async getCashAccountById(
    id: string,
    tenantId = TenantContext.require(),
  ): Promise<CashAccountEntity> {
    return this.runInTenantTx(tenantId, async (em) => {
      const account = await em
        .getRepository(CashAccountEntity)
        .findOne({ where: { id, tenantId } });
      if (!account) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CASH_ACCOUNT_NOT_FOUND,
          `Cash account ${id} not found`,
          404,
        );
      }
      return account;
    });
  }

  async updateCashAccount(
    id: string,
    dto: UpdateCashAccountDto,
    tenantId = TenantContext.require(),
  ): Promise<CashAccountEntity> {
    return this.runInTenantTx(tenantId, async (em) => {
      const repo = em.getRepository(CashAccountEntity);
      const account = await repo.findOne({
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new FinanceDomainError(
          FinanceDomainErrorCode.CASH_ACCOUNT_NOT_FOUND,
          `Cash account ${id} not found`,
          404,
        );
      }

      if (dto.status === 'CLOSED') {
        const balVnd = parseVnd(account.currentBalance, {
          allowZero: true,
          allowNegative: true,
          field: 'currentBalance',
        });
        if (balVnd !== 0) {
          throw new FinanceDomainError(
            FinanceDomainErrorCode.CASH_ACCOUNT_INACTIVE,
            `Cannot close cash account ${account.code} while balance is ${account.currentBalance} VND`,
            409,
          );
        }
        const unresolvedCount = await em
          .getRepository(CashbookEntryEntity)
          .count({
            where: {
              tenantId,
              cashAccountId: account.id,
              status: In(['DRAFT', 'APPROVED']),
            },
          });
        if (unresolvedCount > 0) {
          throw new FinanceDomainError(
            FinanceDomainErrorCode.CASH_ACCOUNT_INACTIVE,
            `Cannot close cash account ${account.code} with ${unresolvedCount} unposted voucher(s)`,
            409,
          );
        }
      }

      if (dto.name !== undefined) {
        account.name = dto.name.trim();
      }
      if (dto.status !== undefined) {
        account.status = dto.status;
      }
      if (dto.bankName !== undefined) {
        account.bankName = dto.bankName.trim();
      }
      account.version += 1;
      account.updatedAt = new Date();
      return repo.save(account);
    });
  }
}
