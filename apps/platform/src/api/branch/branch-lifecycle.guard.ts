import { ErrorCode } from '@/constants/error-code.constant';
import {
  ConflictCodeException,
  ServiceUnavailableCodeException,
} from '@/exceptions/coded.exception';
import { ValidationException } from '@/exceptions/validation.exception';
import { Injectable } from '@nestjs/common';
import { BLOCKERS_SAMPLE_LIMIT } from '@pbl/contracts';
import { EntityManager, In } from 'typeorm';
import { AccountEntity } from '../account/entities/account.entity';
import {
  BlockersUnavailableError,
  BranchBlockersClient,
  ServiceBlocker,
} from '../branch-guard/branch-blockers.client';
import { translate } from '../branch-guard/translate';
import { AccountTenantBranchEntity } from '../tenant/entities/account-tenant-branch.entity';
import { BranchEntity } from './entities/branch.entity';

/**
 * The branch guard (D4): before a branch is deactivated or deleted, collects
 * EVERY reason it cannot be, from every service that owns branch-bound data
 * (asked in parallel) and from platform itself, and refuses with all of them
 * (409 `B005`, `details.reasons`). A service that cannot be asked makes the call
 * fail closed (503 `B009`, the message names the service).
 *
 * Call it inside the transaction that holds the store row lock.
 */
@Injectable()
export class BranchLifecycleGuard {
  constructor(private readonly blockers: BranchBlockersClient) {}

  /**
   * `lastActive`: this deactivation would leave the store with no active
   * branch. Platform keeps its historical `B002` answer when that is the only
   * reason, and lists it with the others otherwise.
   */
  async assertCanDeactivate(
    tenantId: string,
    branchId: string,
    lastActive: boolean,
  ): Promise<void> {
    const reasons = await this.fromServices(tenantId, branchId);
    if (lastActive) {
      if (reasons.length === 0) throw new ValidationException(ErrorCode.B002);
      reasons.unshift(this.lastActiveReason());
    }
    this.refuseIfAny(reasons);
  }

  /**
   * Delete: the services' reasons plus every member the delete would leave with
   * no branch at all. Returns the accounts that lose the branch (their sessions
   * must end after the commit).
   */
  async assertCanDelete(
    em: EntityManager,
    tenantId: string,
    branchId: string,
  ): Promise<string[]> {
    const reasons = await this.fromServices(tenantId, branchId);
    const { losing, stranded } = await this.membersLosing(
      em,
      tenantId,
      branchId,
    );
    if (stranded.length > 0) {
      const names = await this.namesOf(em, stranded);
      reasons.push({
        service: 'platform',
        code: 'PLATFORM_MEMBER_WITHOUT_BRANCH',
        message: translate('branch.reason.member_without_branch', {
          count: stranded.length,
          names: names.join(', '),
        }),
        count: stranded.length,
        samples: stranded.slice(0, BLOCKERS_SAMPLE_LIMIT),
      });
    }
    this.refuseIfAny(reasons);
    return losing;
  }

  private async fromServices(
    tenantId: string,
    branchId: string,
  ): Promise<ServiceBlocker[]> {
    try {
      return await this.blockers.forBranch(tenantId, branchId);
    } catch (error) {
      if (error instanceof BlockersUnavailableError) {
        throw new ServiceUnavailableCodeException(
          ErrorCode.B009,
          `${translate(ErrorCode.B009)} (${error.service})`,
        );
      }
      throw error;
    }
  }

  private lastActiveReason(): ServiceBlocker {
    return {
      service: 'platform',
      code: 'B002',
      message: translate('branch.reason.last_active'),
      count: 1,
    };
  }

  private refuseIfAny(reasons: ServiceBlocker[]): void {
    if (reasons.length === 0) return;
    throw new ConflictCodeException(ErrorCode.B005, translate(ErrorCode.B005), {
      reasons,
    });
  }

  /**
   * Members assigned to the branch: all of them lose it; `stranded` are those
   * with no other live branch (an account with no assignment rows at all sees
   * every branch and is not affected).
   */
  private async membersLosing(
    em: EntityManager,
    tenantId: string,
    branchId: string,
  ): Promise<{ losing: string[]; stranded: string[] }> {
    const [rows, live] = await Promise.all([
      em.find(AccountTenantBranchEntity, { where: { tenantId } }),
      em.find(BranchEntity, { where: { tenantId }, select: { id: true } }),
    ]);
    const liveIds = new Set(live.map((b) => b.id as string));
    const byAccount = new Map<string, string[]>();
    for (const row of rows) {
      byAccount.set(row.accountId, [
        ...(byAccount.get(row.accountId) ?? []),
        row.branchId,
      ]);
    }
    const losing: string[] = [];
    const stranded: string[] = [];
    for (const [accountId, branches] of byAccount) {
      if (!branches.includes(branchId)) continue;
      losing.push(accountId);
      const others = branches.filter(
        (id) => id !== branchId && liveIds.has(id),
      );
      if (others.length === 0) stranded.push(accountId);
    }
    return { losing, stranded };
  }

  private async namesOf(
    em: EntityManager,
    accountIds: string[],
  ): Promise<string[]> {
    const accounts = await em.find(AccountEntity, {
      where: { id: In(accountIds) as never },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(
      accounts.map((a) => [a.id as string, a.name || a.email]),
    );
    return accountIds.map((id) => byId.get(id) ?? id);
  }
}
