import { NotFoundException } from '@nestjs/common';
import { ROLE_CODES } from '@pbl/contracts';

/**
 * Branch ids the caller may act in (`@AllowedBranches()`), null meaning every
 * branch (ADR-0020). A request naming a branch outside it answers 404.
 */
export type BranchScope = readonly string[] | null;

export function branchAllowed(
  scope: BranchScope,
  branchId: string | null | undefined,
): boolean {
  return scope === null || (!!branchId && scope.includes(branchId));
}

/** 404 (never 403) when `branchId` is outside the caller's scope: the row is not revealed. */
export function assertBranchAllowed(
  scope: BranchScope,
  branchId: string | null | undefined,
  errorCode = 'ORDER_NOT_FOUND',
  message = 'Resource not found',
): void {
  if (!branchAllowed(scope, branchId)) {
    throw new NotFoundException({ errorCode, message });
  }
}

/**
 * The branch filter of a list: the requested branch when the caller may see it
 * (404 otherwise), else the caller's branches; null means no filter.
 */
export function branchFilter(
  scope: BranchScope,
  requested?: string | null,
  errorCode?: string,
  message?: string,
): string[] | null {
  if (requested) {
    assertBranchAllowed(scope, requested, errorCode, message);
    return [requested];
  }
  return scope === null ? null : [...scope];
}

/**
 * Discount ceiling tier of a caller, from permissions (never from a role name):
 * the owner (`*`) may discount up to 100 percent, whoever may approve orders up
 * to 30, everyone else up to 10. The tier uses the seeded role codes as labels.
 */
export function discountTierFor(permissions: readonly string[]): string {
  if (permissions.includes('*')) return ROLE_CODES.OWNER;
  if (permissions.includes('orders.approve')) return ROLE_CODES.BRANCH_MANAGER;
  return ROLE_CODES.SALES_STAFF;
}
