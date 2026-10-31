import { NotFoundException } from '@nestjs/common';

/** Branch ids a caller may act in; null means every branch (ADR-0012 §8) */
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
