# ADR-0009: Shared libraries are published to GitHub Packages and versioned with semver

- **Status:** Accepted (2026-10-11)
- **Date:** 2026-10-11
- **Scope:** `libs/auth`, `libs/common`, `scripts/build-libs.mjs`, `scripts/check-lib-version.mjs`, `.github/workflows/ci.yml`, `.github/workflows/publish-libs.yml`

## Context

[ADR-0006](0006-shared-code-in-libs.md) put shared code in `libs/` and imports
it by path alias (`@pbl/auth`, `@pbl/common`). That works while every service
lives in this repo and deploys from one commit. Jira SCRUM-27 asks for the
shared packages to be published to GitHub Packages with semver, and for a
breaking change to bump the major version, so services (and the `pbl-*` sibling
repos) can depend on a released version instead of a path.

## Decision

- **Names and registry.** `@sapoclone/pbl-auth` and `@sapoclone/pbl-common`
  (the npm scope is the GitHub organization, `SapoClone`), published to
  `https://npm.pkg.github.com` (`publishConfig.registry`). Both start at
  `1.0.0`. Inside the monorepo nothing changes: apps keep importing
  `@pbl/auth` / `@pbl/common` through the path aliases and are built from source.
- **Package layout.** Each `libs/<name>/package.json` has `main`/`types` in
  `dist` and `files: ["dist", "README.md", "CHANGELOG.md"]`, so a tarball holds
  compiled JS and `.d.ts` only: no specs, no source maps (disabled, they would
  point at absent sources), no keys. `pnpm build:libs` emits to
  `libs/<name>/dist` (git-ignored); `pnpm pack:libs` builds and packs both into
  `dist/packs/`.
- **Dependencies.** Anything that must be a single instance in the app, or that
  the app already owns, is a `peerDependency` with the root `package.json`
  range: `@nestjs/*` (including `@nestjs/platform-express`), `rxjs`,
  `reflect-metadata`, `typeorm`, `axios`, `nestjs-pino`, `pino-http`,
  `class-validator`, `class-transformer` (loaded at runtime by the
  `ValidationPipe` that `bootstrapService` installs), and for auth also `@nestjs/config`,
  `@nestjs/jwt`. Libraries only the lib uses are `dependencies`: `ioredis`,
  `jwks-rsa` (auth), `uuid` (common), `tslib` (`importHelpers`).
  The barrel (`index.ts`) loads typeorm, axios, terminus and swagger at import
  time, so all peers must be installed even if a service uses one part.
  `@sapoclone/pbl-common` is a **peer** of `@sapoclone/pbl-auth`: tenant and
  request context are `AsyncLocalStorage` module state, and two copies would
  silently split it.
- **Internal HTTP destinations.** `InternalHttpClient` forwards the user's
  `Authorization` only to a configured destination:
  `PblPropagationModule.forRoot({ baseURL?, allowedHosts? })`. A relative URL
  resolves against `baseURL`; an absolute URL must have its origin or a
  host in `allowedHosts`. With neither configured, a call that would forward
  the token throws (so does a relative URL without `baseURL`); `asService`
  calls carry no token and are not restricted. `config.auth` is refused,
  reserved headers are stripped from nested axios header blocks too, redirects
  are not followed when the token is forwarded, and the token is removed from
  axios errors before they are rethrown.
- **Cross-import rewrite.** `@pbl/auth` imports `@pbl/common` at runtime. The
  published auth must import `@sapoclone/pbl-common`. Chosen mechanism:
  `libs/auth/tsconfig.lib.json` overrides `paths` so `@pbl/common` resolves to
  the built declarations (`libs/common/dist`, hence common is built first), and
  `scripts/build-libs.mjs` rewrites the specifier in the emitted `.js`/`.d.ts`
  afterwards; the build fails if any `@pbl/` specifier is left in `dist`.
  `@pbl/common` must never import `@pbl/auth` at runtime (specs excluded).
- **Release.** Push a tag `pbl-auth-vX.Y.Z` or `pbl-common-vX.Y.Z`.
  `publish-libs.yml` installs, runs `scripts/check-lib-version.mjs --tag`
  (tag version equals that lib's `package.json` version and `CHANGELOG.md` has
  a `## [X.Y.Z]` section), builds, tests, then `pnpm publish --no-git-checks`
  from the lib folder with `GITHUB_TOKEN` (`packages: write`).
- **Major-version rule.** On pull requests the `libs` CI job runs
  `scripts/check-lib-version.mjs --pr`: it compares the export names of each
  lib's `src/index.ts` (TypeScript compiler API, `export *` followed) with
  `origin/main`; a removed or renamed export requires the lib's major to be
  greater than main's. A lib absent on main is new and skipped.
- **What the check cannot see.** Signature, behaviour, peer-range or error-shape
  changes keep the export list intact. They are covered by the CHANGELOG rule
  (every release states its changes; breaking ones say so and bump the major)
  and by review.
- **Rules for authors.** Change a lib's `package.json` version and add its
  CHANGELOG section in the same PR as the change that warrants it; additive
  change is minor, fix is patch, breaking is major.

## Consequences

- Publishing is a deliberate act (a tag), never a side effect of merging.
- A published major cannot be edited; fixes ship as new versions.
- Apps in this repo are not affected until they are switched to the published
  packages; doing so is a separate decision.
- `pack:libs` plus a scratch install outside the repo is how a release is
  smoke-tested. Procedure used for 1.0.0:
  1. `pnpm build:libs && pnpm pack:libs` (tarballs land in `dist/packs/`);
     `npm publish --dry-run` in each lib folder lists the files (no specs, no
     `.map`, no keys) and must exit 0 apart from the login warning.
  2. In an empty directory outside the repo (`node:24-alpine`, pnpm 9.12.3)
     create a `package.json`, then `pnpm add` both `.tgz` files plus the peers
     (`@nestjs/*`, `@nestjs/typeorm`, `typeorm`, `axios`, `nestjs-pino`,
     `pino-http`, `class-validator`, `class-transformer`, `reflect-metadata`,
     `rxjs`, `@types/express`, `@types/node`, `typescript`).
  3. Write `src/app.ts` importing `PblAuthModule`, `CurrentTenant` from
     `@sapoclone/pbl-auth` and `bootstrapService`, `TenantContext` from
     `@sapoclone/pbl-common`; compile with `tsc` (`strict`,
     `skipLibCheck: false`) and `node -e "require(...)"` both packages.
  4. Check that only one copy of `@sapoclone/pbl-common` was installed
     (`find node_modules -path '*pbl-common*' -maxdepth 3`), since two copies
     would split the `AsyncLocalStorage` context.
- Revisit if a lib is split, if consumers outside this organization appear
  (public registry), or if export-list checking proves too coarse.

## Alternatives considered

- **Keep path aliases only.** Simplest, but SCRUM-27 asks for versioned
  packages and sibling repos cannot use aliases.
- **Single `@sapoclone/pbl-libs` package.** One version for unrelated code
  forces needless major bumps on consumers of the other half.
- **Bundle `@pbl/common` into auth.** Duplicates the context singleton.
- **`tsc-alias`/`tsconfig-replace-paths` for the rewrite.** One more
  dependency for a one-specifier substitution; the 20-line script is tested.
- **changesets/semantic-release.** Heavier than two libs warrant today.
