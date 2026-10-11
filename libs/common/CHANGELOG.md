# Changelog

All notable changes to `@sapoclone/pbl-common` are recorded here.
The project follows [Semantic Versioning](https://semver.org): a removed or
renamed export, or any other breaking change, bumps the major version.

## [1.0.0] - 2026-10-11

### Added

- First published release: service bootstrap (`bootstrapService`), request and
  tenant context, standard error filter and error shape, health module,
  pino logging with `X-Request-Id`, internal HTTP client and event envelope
  with tenant/trace propagation, and the tenant-scoped repository.
