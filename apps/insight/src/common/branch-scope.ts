import { NotFoundException } from '@nestjs/common';

/** Branch ids a caller may act in; null means every branch (ADR-0020 §8) */
export type BranchScope = string[] | null;

/** 404 (never 403, so existence is not leaked) when the branch is outside the scope */
export function assertBranchInScope(
  scope: BranchScope,
  branchId: string | null | undefined,
): void {
  if (scope && branchId && !scope.includes(branchId)) {
    throw new NotFoundException();
  }
}

/**
 * Resolves the branch filter of an analytical read from the caller's scope: a named branch (or list of
 * branches) outside the scope is a 404; with none named the allowed branches apply. `undefined` means
 * every branch, an empty array means none (the reads then return nothing).
 */
export function resolveScope(
  scope: BranchScope,
  branchId?: string | null,
  branchIds?: string[] | null,
): { branchId?: string; allowedBranchIds?: string[] } {
  if (branchId) {
    assertBranchInScope(scope, branchId);
    return { branchId, allowedBranchIds: scope ?? undefined };
  }
  if (branchIds && branchIds.length > 0) {
    for (const id of branchIds) assertBranchInScope(scope, id);
    return { allowedBranchIds: branchIds };
  }
  return { allowedBranchIds: scope ?? undefined };
}
