# Changelog

All notable changes to `@sapoclone/pbl-auth` are recorded here.
The project follows [Semantic Versioning](https://semver.org): a removed or
renamed export, or any other breaking change, bumps the major version.

## [1.0.0] - 2026-10-11

### Added

- First published release: `PblAuthModule` (`forRemoteJwks()` for services,
  local keys for platform), `AuthGuard`, access-token verification against
  JWKS, Redis session-revocation deny-list, `@CurrentUser()`,
  `@CurrentTenant()`, `@RequireRoles()` and the tenant-context interceptor.
