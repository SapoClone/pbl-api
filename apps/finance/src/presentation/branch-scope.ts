import { NotFoundException } from '@nestjs/common';
import { AuthUser, allowedBranches, canAccessBranch } from '@pbl/auth';
import { In } from 'typeorm';

/** Branch ids the member may use, or null for every branch (ADR-0020). */
export type BranchScope = string[] | null;

export function branchScopeOf(user: AuthUser): BranchScope {
  return allowedBranches(user);
}

/** A request that names a branch the member may not use answers 404. */
export function assertBranchNamed(
  user: AuthUser,
  branchId: string | null | undefined,
): void {
  if (branchId && !canAccessBranch(user, branchId)) {
    throw new NotFoundException();
  }
}

/**
 * A stored row. Rows without a branch are store-wide: only members with every
 * branch (owner, unrestricted) see them; a restricted member gets 404.
 */
export function assertRowBranch(
  user: AuthUser,
  branchId: string | null | undefined,
): void {
  if (allowedBranches(user) === null) {
    return;
  }
  if (!branchId || !canAccessBranch(user, branchId)) {
    throw new NotFoundException();
  }
}

/** Restricts a TypeORM `where` to the allowed branches unless it already names one. */
export function applyBranchScope(
  where: Record<string, unknown>,
  scope: BranchScope | undefined,
): void {
  if (scope && where.branchId === undefined) {
    where.branchId = In(scope);
  }
}
