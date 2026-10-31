/**
 * Pure TypeScript Domain Layer for SapoClone Platform Bounded Context (M0 / M7.5).
 * Zero NestJS, TypeORM, Redis, or HTTP dependencies.
 *
 * Encapsulates:
 * - Value Objects: SubdomainVO, BranchCodeVO
 * - Aggregates & Policies:
 *   - AccountLifecyclePolicy (active account requirement for store creation & session issuance)
 *   - TenantMembershipAggregate (owner role immutability T003, member uniqueness T002, role transition)
 *   - BranchLifecyclePolicy (last-active-branch invariant B002, deactivation detection)
 */

export type PlatformAccountStatus = 'active' | 'inactive' | 'suspended';
export type PlatformTenantStatus = 'active' | 'inactive' | 'suspended';
export type PlatformBranchStatus = 'active' | 'inactive';
/** A role code; roles are tenant data (platform RBAC), so only `owner` is special. */
export type PlatformTenantRole = string;

export const PlatformDomainErrorCode = {
  ACCOUNT_NOT_ACTIVE: 'ACCOUNT_NOT_ACTIVE',
  INVALID_SUBDOMAIN: 'INVALID_SUBDOMAIN',
  SUBDOMAIN_EXISTS: 'tenant.error.subdomain_exists', // T001
  MEMBER_ALREADY_EXISTS: 'tenant.error.member_exists', // T002
  OWNER_ROLE_LOCKED: 'tenant.error.owner_role_locked', // T003
  INVALID_BRANCH_CODE: 'INVALID_BRANCH_CODE',
  BRANCH_CODE_EXISTS: 'branch.error.code_exists', // B001
  LAST_ACTIVE_BRANCH: 'branch.error.last_branch', // B002
} as const;

export type PlatformDomainErrorCodeType =
  (typeof PlatformDomainErrorCode)[keyof typeof PlatformDomainErrorCode];

export class PlatformDomainError extends Error {
  constructor(
    public readonly code: PlatformDomainErrorCodeType,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformDomainError';
  }
}

const SUBDOMAIN_REGEX = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const BRANCH_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

/**
 * Value Object representing a validated, normalized tenant subdomain.
 */
export class SubdomainVO {
  public readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static create(raw: string): SubdomainVO {
    const normalized = (raw ?? '').trim().toLowerCase();
    if (!SUBDOMAIN_REGEX.test(normalized)) {
      throw new PlatformDomainError(
        PlatformDomainErrorCode.INVALID_SUBDOMAIN,
        `Invalid tenant subdomain "${raw}": must be 3-63 lowercase alphanumeric characters or hyphens`,
      );
    }
    return new SubdomainVO(normalized);
  }

  equals(other: SubdomainVO): boolean {
    return this.value === other.value;
  }
}

/**
 * Value Object representing a validated, normalized store branch code.
 */
export class BranchCodeVO {
  public readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static create(raw: string): BranchCodeVO {
    const normalized = (raw ?? '').trim().toUpperCase();
    if (!BRANCH_CODE_REGEX.test(normalized)) {
      throw new PlatformDomainError(
        PlatformDomainErrorCode.INVALID_BRANCH_CODE,
        `Invalid branch code "${raw}": must be 2-32 uppercase alphanumeric, underscore, or hyphen characters`,
      );
    }
    return new BranchCodeVO(normalized);
  }

  equals(other: BranchCodeVO): boolean {
    return this.value === other.value;
  }
}

/**
 * Enforces that only an active global account can create a new tenant store
 * or be granted store membership.
 */
export function assertAccountIsActive(
  status?: string | null,
): asserts status is 'active' {
  if (status !== 'active') {
    throw new PlatformDomainError(
      PlatformDomainErrorCode.ACCOUNT_NOT_ACTIVE,
      'Only an active account may perform this operation',
    );
  }
}

/**
 * Aggregate encapsulating TenantMembership lifecycle and role-change invariants.
 * Invariant: A store's `owner` membership cannot be demoted or reassigned via role change (T003).
 */
export class TenantMembershipAggregate {
  constructor(
    public readonly accountId: string,
    public readonly tenantId: string,
    private _role: PlatformTenantRole,
  ) {}

  get role(): PlatformTenantRole {
    return this._role;
  }

  /**
   * Validates and applies a role change on a tenant member.
   * Returns `{ changed: boolean; previousRole: PlatformTenantRole; newRole: PlatformTenantRole }`.
   */
  assertNotOwner(): void {
    if (this._role === 'owner') {
      throw new PlatformDomainError(
        PlatformDomainErrorCode.OWNER_ROLE_LOCKED,
        'The store owner role cannot be modified',
      );
    }
  }

  changeRole(nextRole: PlatformTenantRole): {
    changed: boolean;
    previousRole: PlatformTenantRole;
    newRole: PlatformTenantRole;
  } {
    if (this._role === 'owner') {
      throw new PlatformDomainError(
        PlatformDomainErrorCode.OWNER_ROLE_LOCKED,
        'The store owner role cannot be modified',
      );
    }
    const previousRole = this._role;
    if (previousRole === nextRole) {
      return { changed: false, previousRole, newRole: nextRole };
    }
    this._role = nextRole;
    return { changed: true, previousRole, newRole: nextRole };
  }
}

/**
 * Determines whether a branch update transitions an active branch into an inactive state.
 */
export function isBranchDeactivating(
  currentStatus: PlatformBranchStatus | string,
  nextStatus?: PlatformBranchStatus | string,
): boolean {
  return currentStatus === 'active' && nextStatus === 'inactive';
}

/**
 * Enforces the Tenant Branch Invariant (B002):
 * Every tenant store must retain at least one active branch at all times.
 */
export function assertNotLastActiveBranch(activeBranchCount: number): void {
  if (activeBranchCount <= 1) {
    throw new PlatformDomainError(
      PlatformDomainErrorCode.LAST_ACTIVE_BRANCH,
      'Cannot deactivate or delete the last active branch of a tenant store',
    );
  }
}
