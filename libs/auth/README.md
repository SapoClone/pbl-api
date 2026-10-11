# @sapoclone/pbl-auth

JWT/JWKS access-token verification, guards, decorators and tenant context for
PBL services. Published to GitHub Packages; inside the monorepo it is
imported as `@pbl/auth` (path alias).

## Install

```ini
# .npmrc of the consuming project
@sapoclone:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
pnpm add @sapoclone/pbl-auth @sapoclone/pbl-common
```

`@sapoclone/pbl-common` is a **peer** dependency on purpose: the tenant and
request context live in module state, so the app and `pbl-auth` must share one
copy. Also install the other peers (`@nestjs/common`, `@nestjs/core`,
`@nestjs/config`, `@nestjs/jwt`, `rxjs`, `reflect-metadata`). `@types/express` is an
optional peer: install it if you compile TypeScript against the declarations.

## Use

```ts
import { PblAuthModule } from '@sapoclone/pbl-auth';

@Module({ imports: [PblAuthModule.forRemoteJwks()] })
export class AppModule {}
```

## Versioning

Semver. Breaking changes bump the major version; see `CHANGELOG.md` and
`docs/decisions/0009-shared-libraries-and-versioning.md` in the repository.
