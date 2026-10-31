import { AuthUser } from './auth.types';

const WILDCARD = '*';

type Caller = Pick<AuthUser, 'permissions' | 'branches'>;

/** True when the caller holds at least one of `codes` (`'*'` passes any). */
export function hasPermission(
  user: Pick<AuthUser, 'permissions'>,
  ...codes: string[]
): boolean {
  return (
    user.permissions.includes(WILDCARD) ||
    codes.some((code) => user.permissions.includes(code))
  );
}

/** True when the caller may act in `branchId` (`'*'` allows every branch). */
export function canAccessBranch(
  user: Pick<Caller, 'branches'>,
  branchId: string,
): boolean {
  return user.branches.includes(WILDCARD) || user.branches.includes(branchId);
}

/** Branch ids the caller may act in; null means every branch. */
export function allowedBranches(
  user: Pick<Caller, 'branches'>,
): string[] | null {
  return user.branches.includes(WILDCARD) ? null : [...user.branches];
}
