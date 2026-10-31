# Changelog

All notable changes to `@sapoclone/pbl-auth` are recorded here.
The project follows [Semantic Versioning](https://semver.org): a removed or
renamed export, or any other breaking change, bumps the major version.

## [1.1.0] - 2026-10-31

### Added

- `perms` and `branches` access-token claims, read into `AuthUser.permissions`
  and `AuthUser.branches` (`['*']` = all). A token without `perms` reads as
  `['*']` for an owner and no permissions otherwise; without `branches`, all.
- `@RequirePermission(...codes)`: the caller needs at least one code (403
  otherwise); combined with `@RequireRoles` both must pass.
- Helpers `hasPermission`, `canAccessBranch`, `allowedBranches` and the
  `@AllowedBranches()` parameter decorator.
- `createTestAuth()` (testing helper) signs tokens with permissions and branches.

## [1.0.0] - 2026-10-11

### Added

- First published release: `PblAuthModule` (`forRemoteJwks()` for services,
  local keys for platform), `AuthGuard`, access-token verification against
  JWKS, Redis session-revocation deny-list, `@CurrentUser()`,
  `@CurrentTenant()`, `@RequireRoles()` and the tenant-context interceptor.
