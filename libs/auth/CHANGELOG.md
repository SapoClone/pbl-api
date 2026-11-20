# Changelog

All notable changes to `@sapoclone/pbl-auth` are recorded here.
The project follows [Semantic Versioning](https://semver.org): a removed or
renamed export, or any other breaking change, bumps the major version.

## [1.4.0] - 2026-11-20

### Added

- Support-session tokens (ADR-0025, ADR-0004 §3): the verifier reads the `act` (`{ sub, ssn }`) and `read_only` claims
  into the new optional `AuthUser.readOnly` and `AuthUser.actor` fields (`act` alone or `read_only` alone is enough; a
  malformed `act` is a 401).
- `AuthGuard` refuses every request of a read-only token that is not GET, HEAD or OPTIONS with 403 and error code
  `AUTH_READ_ONLY`, before the handler runs, and refuses `/internal/...` routes outright. A POST that only reads is
  refused too. Such a token is neither a platform admin (403 on `@RequirePlatformAdmin` routes) nor a member.
- `@AllowSupportToken()`: lets a read-only token reach one route (platform's "end support session"); the handler must
  check `user.actor`.
- `AUTH_READ_ONLY` constant; `createTestAuth().supportBearer(tid)` and a `support` option for `token()`.

### Changed

- Nothing breaks: tokens without `act`/`read_only` behave as before.

## [1.3.0] - 2026-11-03

### Added

- `@RequirePlatformAdmin(...roles)` (ADR-0022): marks a route or controller as a platform-admin route. Only a token
  with `sub_type = platform_admin` passes, without a store, and with roles given the admin must hold one (403
  otherwise); a handler's roles override its controller's.
- `createTestAuth().adminBearer(role)` and a `subjectType` option for `token()` (testing helper).

### Changed

- `AuthGuard` refuses a `platform_admin` token on every route that is not marked `@RequirePlatformAdmin` (403), so
  an admin token cannot act in a store, and refuses a store token on an admin route. Nothing issued such tokens
  before, so no existing caller is affected.

## [1.2.0] - 2026-10-31

### Added

- `CurrentContext` parameter decorator and the `AuthenticatedContext` type: the verified caller and the required
  store (user id, tenant id, roles, session id, subject type) in one object, for tenant-scoped services.

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
