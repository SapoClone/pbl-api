# @sapoclone/pbl-common

Shared Nest building blocks for PBL services. Published to GitHub Packages;
inside the monorepo it is imported as `@pbl/common` (path alias).

## Install

```ini
# .npmrc of the consuming project
@sapoclone:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
pnpm add @sapoclone/pbl-common
```

Install the peer dependencies the package declares (`@nestjs/*` including
`@nestjs/platform-express`, `typeorm`, `nestjs-pino`, `pino-http`, `axios`,
`class-validator`, `class-transformer`, `rxjs`, `reflect-metadata`). The barrel
loads typeorm, axios, terminus and swagger when imported, so all of them must
be installed even if you use only part of the package.

`InternalHttpClient` forwards the caller's `Authorization` only to a destination
you configure: `PblPropagationModule.forRoot({ baseURL, allowedHosts })`.
Without either, a call that would forward the token throws.

## Use

```ts
import { bootstrapService } from '@sapoclone/pbl-common';
```

## Versioning

Semver. Breaking changes bump the major version; see `CHANGELOG.md` and
`docs/decisions/0009-shared-libraries-and-versioning.md` in the repository.
