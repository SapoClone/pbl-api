import { ForbiddenException } from '@nestjs/common';
import { Request } from 'express';

export interface InsightAuthenticatedUser {
  sub?: string;
  accountId?: string;
  tenantId?: string;
  roles?: string[];
  branchIds?: string[];
}

/**
 * Resolves branch-scope authorization for analytical queries and exports.
 * - Owners have tenant-wide access across all branches unless they filter by branchId.
 * - Branch managers with assigned branchIds (from JWT claims or x-allowed-branches header)
 *   are restricted to their assigned branches; requesting an unauthorized branchId throws 403.
 */
export function resolveAuthorizedBranchScope(
  req: Request,
  requestedBranchId?: string | null,
  requestedBranchIds?: string[] | null,
): {
  branchId?: string;
  allowedBranchIds?: string[];
} {
  const user = (req['user'] ?? {}) as InsightAuthenticatedUser;
  const roles = (user.roles ?? []).map((r) => r.toLowerCase());
  const isOwner = roles.includes('owner');

  let userAssignedBranches: string[] | undefined = Array.isArray(user.branchIds)
    ? user.branchIds
    : undefined;

  const headerBranches =
    req.headers['x-allowed-branches'] ?? req.headers['x-branch-scope'];
  if (!userAssignedBranches && typeof headerBranches === 'string') {
    const parsed = headerBranches
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parsed.length > 0) {
      userAssignedBranches = parsed;
    }
  }

  // Owners have unrestricted tenant-wide branch access unless explicit header scope is set for testing
  const restrictedBranches =
    !isOwner && userAssignedBranches && userAssignedBranches.length > 0
      ? userAssignedBranches
      : undefined;

  if (requestedBranchId) {
    if (restrictedBranches && !restrictedBranches.includes(requestedBranchId)) {
      throw new ForbiddenException(
        `Access denied for branch ${requestedBranchId}`,
      );
    }
    return {
      branchId: requestedBranchId,
      allowedBranchIds: restrictedBranches,
    };
  }

  if (requestedBranchIds && requestedBranchIds.length > 0) {
    if (restrictedBranches) {
      for (const bid of requestedBranchIds) {
        if (!restrictedBranches.includes(bid)) {
          throw new ForbiddenException(`Access denied for branch ${bid}`);
        }
      }
    }
    return {
      allowedBranchIds: requestedBranchIds,
    };
  }

  return {
    allowedBranchIds: restrictedBranches,
  };
}
