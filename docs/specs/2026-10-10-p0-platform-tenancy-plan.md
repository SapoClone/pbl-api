# P0 Platform Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accounts can create stores (tenants) with branches. Access tokens carry the selected store (`tid`) and the caller's role in it (`roles`). Every service can read both through `@pbl/auth`.

**Architecture:**
- Platform renames `user` → `account` and adds `tenant`, `account_tenant` and `branch`.
- A `MembershipModule` (active memberships) is shared by `AuthModule` (login, switch, refresh) and `TenantModule` (create store), which avoids a module cycle.
- `@pbl/auth` maps the new claims, adds `@CurrentTenant()`, `@TenantOptional()` and `@RequireRoles()`, and has a `tenant: 'required' | 'optional'` mode. Platform uses `optional`; every other service uses `required`.

**Tech Stack:** NestJS 11, TypeORM 0.3 (Postgres, schema `platform`), class-validator/class-transformer, Jest + ts-jest, KrakenD 2.6, Docker Compose.

**Spec:** [`docs/specs/2026-10-10-p0-platform-tenancy-design.md`](2026-10-10-p0-platform-tenancy-design.md). Also read [`CLAUDE.md`](../../CLAUDE.md), [`docs/conventions/api-conventions.md`](../conventions/api-conventions.md) and [ADR-0008](../decisions/0008-tenancy.md).

## Global Constraints

- **Branch:** `feat/p0-platform-tenancy`, Conventional Commits.
- **No attribution:** **never** add `Co-Authored-By` or "Generated with" lines.
- **Tables (schema `platform`):**
  - `account(id, email, password, name varchar(100) not null default '', phone varchar(20) null, status varchar(20) default 'active', deleted_at, audit cols)`;
  - `tenant(id, name varchar(150), subdomain varchar(30), phone, email, address, status varchar(20) default 'active', deleted_at, audit cols)`;
  - `account_tenant(account_id, tenant_id, role varchar(32), created_at)` with PK `(account_id, tenant_id)`;
  - `branch(id, tenant_id, name varchar(150), code varchar(20), address, phone, is_warehouse bool default true, status varchar(20) default 'active', deleted_at, audit cols)`.
- **Constraint names:**
  - `PK_account_id`, `UQ_account_email`;
  - `PK_tenant_id`, `UQ_tenant_subdomain`;
  - `PK_account_tenant`, `FK_account_tenant_account`, `FK_account_tenant_tenant`;
  - `PK_branch_id`, `FK_branch_tenant`, `UQ_branch_tenant_code`, `IDX_branch_tenant_id`.
  - Unique indexes are partial on `"deleted_at" IS NULL`.
- **Token claims:** `tid` (absent when no store is selected) and `roles` (`[]` without `tid`). `sub_type` stays `account`.
- **Login response** keeps `userId`, `accessToken`, `refreshToken`, `tokenExpires`, and adds `tenantId: string | null` and `tenants: [{id, name, subdomain, role}]`.
- **Subdomain:** trimmed and lowercased, then must match `^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$`. Reserved: `www, api, admin, app, static, platform, catalog, commerce, finance, insight, integration`. It cannot change after creation.
- **Branch code:** trimmed and uppercased, then must match `^[A-Z0-9_-]{1,20}$`.
- **Default branch** on store creation: `{ code: 'CN01', name: 'Chi nhánh chính', isWarehouse: true }`.
- **Errors:**
  - another tenant's resource or a non-member tenant → **404**;
  - no tenant in the token on a tenant route, or a missing role → **403**;
  - `T001 tenant.error.subdomain_exists`, `B001 branch.error.code_exists`, `B002 branch.error.last_branch` → **400**, with messages in en/vi/jp.
- **Status codes:** create returns **201** and delete returns **204** (`api-conventions.md` §2).
- **Removed routes:** `/users/*` and `/posts/*`. `GET /users/me` becomes `GET /accounts/me`.
- **Running tests and lint** (no host `node_modules`; Git Bash on Windows needs `export MSYS_NO_PATHCONV=1` and `$(pwd -W)` in place of `$PWD`):
  ```bash
  docker compose run --rm --no-deps -v "$PWD:/work" -w /work platform sh -c \
    'ln -sf /app/node_modules node_modules; <COMMAND>; rm -f node_modules'
  ```
  Below this is written as **`IN_IMAGE "<COMMAND>"`**. Run `docker compose build platform` once if `package.json` changed. Before committing, format with `IN_IMAGE "pnpm exec prettier --write <files> && pnpm exec eslint <files>"`.

## Review Focus

1. **Two stores created at the same time with the same subdomain:** both pass the pre-check, and the database unique index rejects one. The caller should get **400 `T001`**, not a 500. Pinned in Task 5 (`isUniqueViolation` + service test).
2. **Subdomain typed with capitals or spaces** (`" My-Shop "`): it should be stored as `my-shop`, not rejected or saved as typed. Pinned in Task 5 (DTO test).
3. **Deactivating the last active branch** (`PATCH status=inactive`): it should be refused like deleting it (**`B002`**). Deleting or deactivating an *inactive* branch is fine. Pinned in Task 6.
4. **Login or switch with the `tenantId` of a suspended or deleted store:** it should answer **404**, exactly like a store the caller doesn't belong to. Pinned in Task 3 (membership query filters) and Task 4 (service test).
5. **An access token issued before `switch-tenant`:** it should stop working immediately, because the old family is revoked and its `sid` denied. Pinned in Task 4 (unit) and Task 8 (live check in the verify script).

---

## File structure

| Path | Responsibility |
|---|---|
| `libs/auth/src/auth.types.ts` | add `tid`/`roles` claims, `AuthUser.tenantId`/`roles`, `TenantMode`, `PblAuthOptions.tenant` |
| `libs/auth/src/auth.constants.ts` | `IS_TENANT_OPTIONAL`, `REQUIRED_ROLES` metadata keys |
| `libs/auth/src/auth.decorators.ts` | `CurrentTenant`, `TenantOptional`, `RequireRoles` |
| `libs/auth/src/access-token.verifier.ts` | map `tid` → `tenantId`, `roles` |
| `libs/auth/src/auth.guard.ts` | enforce tenant mode and roles |
| `libs/auth/src/pbl-auth.module.ts` | `forRemoteJwks()` → `tenant: 'required'` |
| `apps/platform/src/api/account/**` | replaces `api/user/**`: `AccountEntity`, `/accounts/me` |
| `apps/platform/src/api/tenant/entities/*.ts` | `TenantEntity`, `AccountTenantEntity` |
| `apps/platform/src/api/tenant/membership.{module,service}.ts` | active memberships for an account |
| `apps/platform/src/api/tenant/tenant.{module,controller,service}.ts` | `/tenants` |
| `apps/platform/src/api/branch/**` | `BranchEntity`, `/branches` |
| `apps/platform/src/api/auth/**` | tenant-aware sign-in, switch, refresh |
| `apps/platform/src/utils/db-errors.ts` | `isUniqueViolation()` |
| `apps/platform/src/database/migrations/1791563000000-introduce-tenancy.ts` | schema change |
| `apps/platform/src/i18n/{en,vi,jp}/{tenant,branch}.json`, `generated/i18n.generated.ts` | error messages |
| `krakend/krakend.json`, `scripts/verify-local-stack.sh` | routes, `tid` claim header, end-to-end checks |
| Deleted: `api/user/**`, `api/post/**`, post factory/seeder | |

---

### Task 1: `@pbl/auth` — tenant and role support

**Files:**
- Modify: `libs/auth/src/auth.types.ts`, `libs/auth/src/auth.constants.ts`, `libs/auth/src/auth.decorators.ts`, `libs/auth/src/access-token.verifier.ts`, `libs/auth/src/auth.guard.ts`, `libs/auth/src/pbl-auth.module.ts`
- Test: `libs/auth/src/access-token.verifier.spec.ts` (update), `libs/auth/src/auth.guard.spec.ts` (replace), `libs/auth/src/pbl-auth.module.spec.ts` (update)
- Modify: `apps/platform/src/api/auth/auth.module.ts` (pass `tenant: 'optional'`), `apps/platform/src/api/auth/access-token.service.spec.ts` (expect `roles: []`)

**Interfaces:**
- Produces:
  - `AuthUser = { id: string; sessionId: string; subjectType: AccessTokenSubjectType; tenantId?: string; roles: string[]; exp: number }`
  - `AccessTokenClaims` gains `tid?: string; roles?: string[]`
  - `type TenantMode = 'required' | 'optional'`; `PblAuthOptions.tenant?: TenantMode` (default `'required'`)
  - Decorators: `CurrentTenant(): ParameterDecorator` (returns `string`, throws `ForbiddenException`), `TenantOptional(): CustomDecorator`, `RequireRoles(...roles: string[]): CustomDecorator`

- [ ] **Step 1: Update the verifier test to expect the new fields**

In `libs/auth/src/access-token.verifier.spec.ts`, replace the first test and add two after it:

```ts
  it('should return the caller for a valid token without a tenant', async () => {
    await expect(verifier.verify(await sign())).resolves.toEqual({
      id: 'user-1',
      sessionId: 'session-1',
      subjectType: 'account',
      tenantId: undefined,
      roles: [],
      exp: expect.any(Number),
    });
  });

  it('should map tid and roles', async () => {
    const token = await sign({
      payload: { ...claims, tid: 'tenant-1', roles: ['owner'] },
    });

    await expect(verifier.verify(token)).resolves.toMatchObject({
      tenantId: 'tenant-1',
      roles: ['owner'],
    });
  });

  it('should treat a non-array roles claim as no roles', async () => {
    const token = await sign({ payload: { ...claims, roles: 'owner' } });

    await expect(verifier.verify(token)).resolves.toMatchObject({ roles: [] });
  });
```

- [ ] **Step 2: Replace the guard test**

Overwrite `libs/auth/src/auth.guard.spec.ts`:

```ts
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessTokenVerifier } from './access-token.verifier';
import { AuthGuard } from './auth.guard';
import { AuthOptional, Public, RequireRoles, TenantOptional } from './auth.decorators';
import { AuthUser, PblAuthOptions } from './auth.types';

class Handlers {
  plain() {}
  @Public() open() {}
  @AuthOptional() maybe() {}
  @TenantOptional() noTenant() {}
  @RequireRoles('owner') ownerOnly() {}
}

const user = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u1',
  sessionId: 's1',
  subjectType: 'account',
  roles: [],
  exp: 0,
  ...overrides,
});

describe('AuthGuard', () => {
  const verifier = { verify: jest.fn() } as unknown as AccessTokenVerifier & { verify: jest.Mock };
  const guardFor = (tenant: PblAuthOptions['tenant']) =>
    new AuthGuard(new Reflector(), verifier, { tenant } as PblAuthOptions);
  const context = (handler: keyof Handlers, authorization?: string) => {
    const request: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
    return {
      ctx: {
        getHandler: () => Handlers.prototype[handler],
        getClass: () => Handlers,
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext,
      request,
    };
  };

  beforeEach(() => jest.resetAllMocks());

  it('lets @Public() routes through without a token', async () => {
    await expect(guardFor('required').canActivate(context('open').ctx)).resolves.toBe(true);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('lets @AuthOptional() routes through without a token', async () => {
    await expect(guardFor('required').canActivate(context('maybe').ctx)).resolves.toBe(true);
  });

  it('rejects a protected route without a token (401)', async () => {
    await expect(guardFor('optional').canActivate(context('plain').ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('sets request.user from a valid token', async () => {
    verifier.verify.mockResolvedValue(user({ tenantId: 't1' }));
    const { ctx, request } = context('plain', 'Bearer abc');

    await expect(guardFor('required').canActivate(ctx)).resolves.toBe(true);
    expect(verifier.verify).toHaveBeenCalledWith('abc');
    expect(request.user).toMatchObject({ tenantId: 't1' });
  });

  it('in required mode, rejects a token without tid (403)', async () => {
    verifier.verify.mockResolvedValue(user());

    await expect(guardFor('required').canActivate(context('plain', 'Bearer abc').ctx)).rejects.toThrow(ForbiddenException);
  });

  it('in required mode, @TenantOptional() accepts a token without tid', async () => {
    verifier.verify.mockResolvedValue(user());

    await expect(guardFor('required').canActivate(context('noTenant', 'Bearer abc').ctx)).resolves.toBe(true);
  });

  it('defaults to required mode when the option is missing', async () => {
    verifier.verify.mockResolvedValue(user());

    await expect(guardFor(undefined).canActivate(context('plain', 'Bearer abc').ctx)).rejects.toThrow(ForbiddenException);
  });

  it('in optional mode, accepts a token without tid', async () => {
    verifier.verify.mockResolvedValue(user());

    await expect(guardFor('optional').canActivate(context('plain', 'Bearer abc').ctx)).resolves.toBe(true);
  });

  it('@RequireRoles() rejects a caller without the role (403), even in optional mode', async () => {
    verifier.verify.mockResolvedValue(user({ tenantId: 't1', roles: ['staff'] }));

    await expect(guardFor('optional').canActivate(context('ownerOnly', 'Bearer abc').ctx)).rejects.toThrow(ForbiddenException);
  });

  it('@RequireRoles() rejects a caller without a tenant (403)', async () => {
    verifier.verify.mockResolvedValue(user({ roles: ['owner'] }));

    await expect(guardFor('optional').canActivate(context('ownerOnly', 'Bearer abc').ctx)).rejects.toThrow(ForbiddenException);
  });

  it('@RequireRoles() accepts a caller with the role', async () => {
    verifier.verify.mockResolvedValue(user({ tenantId: 't1', roles: ['owner'] }));

    await expect(guardFor('optional').canActivate(context('ownerOnly', 'Bearer abc').ctx)).resolves.toBe(true);
  });
});
```

- [ ] **Step 3: Update the module integration test**

In `libs/auth/src/pbl-auth.module.spec.ts`:
- Import `CurrentTenant`, `TenantOptional` and `RequireRoles` next to the existing decorators.
- Add three handlers to `ProbeController`:

```ts
  @TenantOptional()
  @Get('account-level')
  accountLevel(@CurrentUser('id') id: string) {
    return { id };
  }

  @Get('tenant')
  tenant(@CurrentTenant() tenantId: string) {
    return { tenantId };
  }

  @RequireRoles('owner')
  @Get('owner')
  owner() {
    return { ok: true };
  }
```

- Change `sign` to take claims:

```ts
  const sign = (extra: object = {}, key = privateKey) =>
    jwtService.signAsync(
      { sub: 'user-1', sid: 'session-1', sub_type: 'account', ...extra },
      {
        privateKey: key.export({ type: 'pkcs8', format: 'pem' }),
        algorithm: 'RS256',
        keyid: 'key-1',
        issuer: 'platform',
        audience: 'pbl6',
        expiresIn: '5m',
      },
    );
```

- Replace the call in the "not published" test with `sign({}, stranger.privateKey)`.
- Replace the "should accept a token signed with the published key" test with:

```ts
  it('should accept a token with a tenant and expose the caller', async () => {
    const res = await request(app.getHttpServer())
      .get('/closed')
      .set('Authorization', `Bearer ${await sign({ tid: 'tenant-1', roles: ['owner'] })}`)
      .expect(200);

    expect(res.body).toMatchObject({
      id: 'user-1',
      sessionId: 'session-1',
      subjectType: 'account',
      tenantId: 'tenant-1',
      roles: ['owner'],
    });
  });

  it('should reject a token without a tenant on a normal route (403)', async () => {
    await request(app.getHttpServer())
      .get('/closed')
      .set('Authorization', `Bearer ${await sign()}`)
      .expect(403);
  });

  it('should accept a token without a tenant on a @TenantOptional() route', async () => {
    await request(app.getHttpServer())
      .get('/account-level')
      .set('Authorization', `Bearer ${await sign()}`)
      .expect(200, { id: 'user-1' });
  });

  it('should inject the tenant with @CurrentTenant()', async () => {
    await request(app.getHttpServer())
      .get('/tenant')
      .set('Authorization', `Bearer ${await sign({ tid: 'tenant-9' })}`)
      .expect(200, { tenantId: 'tenant-9' });
  });

  it('should enforce @RequireRoles()', async () => {
    await request(app.getHttpServer())
      .get('/owner')
      .set('Authorization', `Bearer ${await sign({ tid: 't', roles: ['staff'] })}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/owner')
      .set('Authorization', `Bearer ${await sign({ tid: 't', roles: ['owner'] })}`)
      .expect(200);
  });
```

- [ ] **Step 4: Run the lib tests to verify they fail**

Run: `IN_IMAGE "pnpm exec jest libs"`
Expected: FAIL. `TenantOptional`, `RequireRoles` and `CurrentTenant` are not exported, and the verifier returns no `roles`.

- [ ] **Step 5: Implement the types and constants**

`libs/auth/src/auth.types.ts`:
- add `tid?: string;` and `roles?: string[];` to `AccessTokenClaims` (before `iss`);
- replace `AuthUser`;
- add `TenantMode` and the option:

```ts
/** Who is calling, derived from a verified access token (request['user']). */
export type AuthUser = {
  id: string;
  sessionId: string;
  subjectType: AccessTokenSubjectType;
  /** Selected store (`tid` claim); absent until the caller selects one */
  tenantId?: string;
  /** Roles in the selected store (`roles` claim); [] without a store */
  roles: string[];
  /** Expiry of the access token, seconds since epoch */
  exp: number;
};

/**
 * `required`: protected routes need a token with `tid` unless marked
 * @TenantOptional(). `optional`: only @CurrentTenant()/@RequireRoles() need
 * one (platform, where account-level routes run before a store is chosen).
 */
export type TenantMode = 'required' | 'optional';
```

In `PblAuthOptions`, add:

```ts
  /** Default 'required' (ADR-0008) */
  tenant?: TenantMode;
```

`libs/auth/src/auth.constants.ts` — append:

```ts
export const IS_TENANT_OPTIONAL = 'isTenantOptional';
export const REQUIRED_ROLES = 'requiredRoles';
```

- [ ] **Step 6: Implement the decorators**

Replace `libs/auth/src/auth.decorators.ts`:

```ts
import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import {
  IS_AUTH_OPTIONAL,
  IS_PUBLIC,
  IS_TENANT_OPTIONAL,
  REQUIRED_ROLES,
} from './auth.constants';
import { AuthUser } from './auth.types';

/** Skip authentication for this route/controller. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Authenticate when a token is sent, but allow anonymous callers too. */
export const AuthOptional = () => SetMetadata(IS_AUTH_OPTIONAL, true);

/** In `tenant: 'required'` services, allow a token without a selected store. */
export const TenantOptional = () => SetMetadata(IS_TENANT_OPTIONAL, true);

/** Caller must have one of these roles in the selected store (403 otherwise). */
export const RequireRoles = (...roles: string[]) =>
  SetMetadata(REQUIRED_ROLES, roles);

/** The verified caller (AuthUser), or one of its fields: @CurrentUser('id'). */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest()['user'];
    return data ? user?.[data] : user;
  },
);

/** The selected store's id from the token (ADR-0008); 403 if none is selected. */
export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest()['user'];
    if (!user?.tenantId) {
      throw new ForbiddenException('A store must be selected');
    }
    return user.tenantId;
  },
);
```

- [ ] **Step 7: Map the claims in the verifier**

In `libs/auth/src/access-token.verifier.ts`, replace the final `return { ... }` of `verifySignedClaims` with:

```ts
    return {
      id: claims.sub,
      sessionId: claims.sid,
      subjectType: claims.sub_type,
      tenantId: claims.tid || undefined,
      roles: Array.isArray(claims.roles) ? claims.roles : [],
      exp: claims.exp,
    };
```

- [ ] **Step 8: Enforce tenant mode and roles in the guard**

Replace `libs/auth/src/auth.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AccessTokenVerifier } from './access-token.verifier';
import {
  IS_AUTH_OPTIONAL,
  IS_PUBLIC,
  IS_TENANT_OPTIONAL,
  PBL_AUTH_OPTIONS,
  REQUIRED_ROLES,
} from './auth.constants';
import { PblAuthOptions } from './auth.types';

/**
 * Global guard (registered by PblAuthModule): every route needs a valid
 * Bearer access token unless marked @Public() or @AuthOptional(). In
 * `tenant: 'required'` mode the token must also carry a store (`tid`).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
    @Inject(PBL_AUTH_OPTIONS) private readonly options: PblAuthOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const accessToken = this.extractTokenFromHeader(request);

    if (!accessToken) {
      if (this.reflector.getAllAndOverride<boolean>(IS_AUTH_OPTIONAL, targets)) {
        return true;
      }
      throw new UnauthorizedException();
    }

    const user = await this.verifier.verify(accessToken);
    request['user'] = user;

    const requiredRoles =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, targets) ?? [];
    const tenantRequired =
      (this.options.tenant ?? 'required') === 'required' &&
      !this.reflector.getAllAndOverride<boolean>(IS_TENANT_OPTIONAL, targets);

    if ((tenantRequired || requiredRoles.length > 0) && !user.tenantId) {
      throw new ForbiddenException('A store must be selected');
    }
    if (
      requiredRoles.length > 0 &&
      !requiredRoles.some((role) => user.roles.includes(role))
    ) {
      throw new ForbiddenException();
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
```

- [ ] **Step 9: Set the modes**

In `libs/auth/src/pbl-auth.module.ts`, add `tenant: 'required',` to the object returned by the `forRemoteJwks()` factory, and change its doc comment's last line to "Tenant mode: required (ADR-0008)."

In `apps/platform/src/api/auth/auth.module.ts`, add `tenant: 'optional',` to the `PblAuthModule.forRootAsync` factory result, with this comment above it:

```ts
        // Register, create store and switch run before a store is chosen;
        // tenant routes use @CurrentTenant()/@RequireRoles() (ADR-0008).
```

In `apps/platform/src/api/auth/access-token.service.spec.ts`, in the test "should produce tokens the shared verifier accepts", add `roles: [],` to the expected object.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `IN_IMAGE "pnpm exec jest libs apps/catalog/src apps/commerce/src apps/finance/src apps/integration/src apps/insight/src && pnpm exec jest --config apps/platform/jest.config.json"`
Expected: PASS (the lib suites and every platform suite).

- [ ] **Step 11: Commit**

```bash
git add libs/auth apps/platform/src/api/auth/auth.module.ts apps/platform/src/api/auth/access-token.service.spec.ts
git commit -m "feat(auth): tenant and role support in @pbl/auth" -m "Map the tid and roles claims onto AuthUser, add @CurrentTenant(), @TenantOptional() and @RequireRoles(), and a tenant mode: services using forRemoteJwks() now require a selected store; platform runs in optional mode (ADR-0008)."
```

---

### Task 2: Account replaces user; `/accounts/me`; remove posts

**Files:**
- Create: `apps/platform/src/api/account/entities/account.entity.ts`, `apps/platform/src/api/account/account.module.ts`, `apps/platform/src/api/account/account.controller.ts`, `apps/platform/src/api/account/account.service.ts`, `apps/platform/src/api/account/dto/account.res.dto.ts`, `apps/platform/src/api/account/dto/update-account.req.dto.ts`
- Move: `apps/platform/src/api/user/entities/user.entity.spec.ts` → `apps/platform/src/api/account/entities/account.entity.spec.ts`
- Create test: `apps/platform/src/api/account/account.service.spec.ts`
- Delete: `apps/platform/src/api/user/` (whole folder), `apps/platform/src/api/post/` (whole folder), `apps/platform/src/database/factories/post.factory.ts`, `apps/platform/src/database/seeds/1722382752268-post-seeder.ts`
- Rename/modify: `database/factories/user.factory.ts` → `account.factory.ts`, `database/seeds/1722335726360-user-seeder.ts` → `1722335726360-account-seeder.ts`
- Modify: `apps/platform/src/api/api.module.ts`, `apps/platform/src/api/auth/auth.module.ts`, `apps/platform/src/api/auth/auth.service.ts`, `apps/platform/src/api/auth/auth.service.spec.ts`, `apps/platform/src/api/auth/dto/register.req.dto.ts`

**Interfaces:**
- Produces:
  - `AccountEntity` (table `account`): `id`, `email`, `password`, `name: string`, `phone: string | null`, `status: AccountStatus`, `deletedAt`;
  - `enum AccountStatus { ACTIVE = 'active', DISABLED = 'disabled' }`;
  - `AccountModule` exporting `AccountService`;
  - routes `GET/PATCH /api/v1/accounts/me`.

- [ ] **Step 1: Move the entity test and write the service test**

```bash
mkdir -p apps/platform/src/api/account/entities apps/platform/src/api/account/dto
git mv apps/platform/src/api/user/entities/user.entity.spec.ts apps/platform/src/api/account/entities/account.entity.spec.ts
sed -i "s/UserEntity/AccountEntity/g; s/'.\/user.entity'/'.\/account.entity'/" apps/platform/src/api/account/entities/account.entity.spec.ts
```

Create `apps/platform/src/api/account/account.service.spec.ts`:

```ts
import { Repository } from 'typeorm';
import { AccountService } from './account.service';
import { AccountEntity, AccountStatus } from './entities/account.entity';

describe('AccountService', () => {
  const stored = () =>
    new AccountEntity({
      id: 'a1' as AccountEntity['id'],
      email: 'me@example.com',
      password: '$argon2id$stored',
      name: 'Old',
      phone: '0900000000',
      status: AccountStatus.ACTIVE,
      createdAt: new Date('2026-10-10T00:00:00Z'),
    });
  let repository: { findOneByOrFail: jest.Mock; save: jest.Mock };
  let service: AccountService;

  beforeEach(() => {
    repository = {
      findOneByOrFail: jest.fn().mockImplementation(async () => stored()),
      save: jest.fn(async (e) => e),
    };
    service = new AccountService(repository as unknown as Repository<AccountEntity>);
  });

  it('returns the caller without the password', async () => {
    const me = await service.getMe('a1');

    expect(repository.findOneByOrFail).toHaveBeenCalledWith({ id: 'a1' });
    expect(me).toMatchObject({ id: 'a1', email: 'me@example.com', name: 'Old', phone: '0900000000', status: 'active' });
    expect(me).not.toHaveProperty('password');
  });

  it('updates only the fields sent and records the actor', async () => {
    const me = await service.updateMe('a1', { name: 'New' });

    const saved: AccountEntity = repository.save.mock.calls[0][0];
    expect(saved.name).toBe('New');
    expect(saved.phone).toBe('0900000000');
    expect(saved.updatedBy).toBe('a1');
    expect(me.name).toBe('New');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `IN_IMAGE "pnpm exec jest --config apps/platform/jest.config.json account"`
Expected: FAIL with "Cannot find module './account.service'" / "'./account.entity'".

- [ ] **Step 3: Create the entity**

`apps/platform/src/api/account/entities/account.entity.ts`:

```ts
import { Uuid } from '@/common/types/common.type';
import { AbstractEntity } from '@/database/entities/abstract.entity';
import { hashPassword as hashPass } from '@/utils/password.util';
import {
  AfterLoad,
  BeforeInsert,
  BeforeUpdate,
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AccountStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

/** A person who signs up; may own or belong to several stores (ADR-0008). */
@Entity('account')
export class AccountEntity extends AbstractEntity {
  constructor(data?: Partial<AccountEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_account_id' })
  id!: Uuid;

  @Column({ type: 'varchar' })
  @Index('UQ_account_email', { where: '"deleted_at" IS NULL', unique: true })
  email!: string;

  @Column({ type: 'varchar' })
  password!: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  name!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 20, default: AccountStatus.ACTIVE })
  status!: AccountStatus;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', default: null })
  deletedAt: Date;

  // The hash as read from the database, so saving a loaded account (e.g. a
  // profile update) doesn't hash the existing hash again.
  private loadedPassword?: string;

  @AfterLoad()
  rememberLoadedPassword() {
    this.loadedPassword = this.password;
  }

  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword() {
    if (this.password && this.password !== this.loadedPassword) {
      this.password = await hashPass(this.password);
      this.loadedPassword = this.password;
    }
  }
}
```

- [ ] **Step 4: Create the DTOs, service, controller and module**

`apps/platform/src/api/account/dto/account.res.dto.ts`:

```ts
import { ClassField, EnumField, StringField, StringFieldOptional } from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { AccountStatus } from '../entities/account.entity';

@Exclude()
export class AccountResDto {
  @StringField() @Expose() id: string;
  @StringField() @Expose() email: string;
  @StringField({ minLength: 0 }) @Expose() name: string;
  @StringFieldOptional({ nullable: true }) @Expose() phone: string | null;
  @EnumField(() => AccountStatus) @Expose() status: AccountStatus;
  @ClassField(() => Date) @Expose() createdAt: Date;
}
```

`apps/platform/src/api/account/dto/update-account.req.dto.ts`:

```ts
import { StringFieldOptional } from '@/decorators/field.decorators';
import { Matches } from 'class-validator';

export class UpdateAccountReqDto {
  @StringFieldOptional({ maxLength: 100 })
  name?: string;

  @StringFieldOptional({ maxLength: 20 })
  @Matches(/^\+?[0-9]{8,15}$/)
  phone?: string;
}
```

`apps/platform/src/api/account/account.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountResDto } from './dto/account.res.dto';
import { UpdateAccountReqDto } from './dto/update-account.req.dto';
import { AccountEntity } from './entities/account.entity';

@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(AccountEntity)
    private readonly repository: Repository<AccountEntity>,
  ) {}

  async getMe(accountId: string): Promise<AccountResDto> {
    const account = await this.repository.findOneByOrFail({ id: accountId as AccountEntity['id'] });
    return account.toDto(AccountResDto);
  }

  async updateMe(accountId: string, dto: UpdateAccountReqDto): Promise<AccountResDto> {
    const account = await this.repository.findOneByOrFail({ id: accountId as AccountEntity['id'] });
    if (dto.name !== undefined) account.name = dto.name;
    if (dto.phone !== undefined) account.phone = dto.phone;
    account.updatedBy = accountId;
    const saved = await this.repository.save(account);
    return saved.toDto(AccountResDto);
  }
}
```

`apps/platform/src/api/account/account.controller.ts`:

```ts
import { ApiAuth } from '@/decorators/http.decorators';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@pbl/auth';
import { AccountService } from './account.service';
import { AccountResDto } from './dto/account.res.dto';
import { UpdateAccountReqDto } from './dto/update-account.req.dto';

@ApiTags('accounts')
@Controller({ path: 'accounts', version: '1' })
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @ApiAuth({ type: AccountResDto, summary: 'Get my account' })
  @Get('me')
  getMe(@CurrentUser('id') accountId: string): Promise<AccountResDto> {
    return this.accountService.getMe(accountId);
  }

  @ApiAuth({ type: AccountResDto, summary: 'Update my account' })
  @Patch('me')
  updateMe(
    @CurrentUser('id') accountId: string,
    @Body() dto: UpdateAccountReqDto,
  ): Promise<AccountResDto> {
    return this.accountService.updateMe(accountId, dto);
  }
}
```

`apps/platform/src/api/account/account.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AccountEntity } from './entities/account.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AccountEntity])],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
```

- [ ] **Step 5: Delete user and post; rewire auth, register and seeds**

```bash
git rm -r -q apps/platform/src/api/user apps/platform/src/api/post \
  apps/platform/src/database/factories/post.factory.ts \
  apps/platform/src/database/seeds/1722382752268-post-seeder.ts
git mv apps/platform/src/database/factories/user.factory.ts apps/platform/src/database/factories/account.factory.ts
git mv apps/platform/src/database/seeds/1722335726360-user-seeder.ts apps/platform/src/database/seeds/1722335726360-account-seeder.ts
```

`apps/platform/src/api/api.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { HomeModule } from './home/home.module';

@Module({
  imports: [AccountModule, HealthModule, AuthModule, HomeModule],
})
export class ApiModule {}
```

`apps/platform/src/database/factories/account.factory.ts`:

```ts
import { AccountEntity } from '@/api/account/entities/account.entity';
import { SYSTEM_USER_ID } from '@/constants/app.constant';
import { setSeederFactory } from 'typeorm-extension';

export default setSeederFactory(AccountEntity, (fake) => {
  const firstName = fake.person.firstName();
  const lastName = fake.person.lastName();
  return new AccountEntity({
    email: fake.internet.email({ firstName, lastName }),
    password: '12345678',
    name: `${firstName} ${lastName}`,
    createdBy: SYSTEM_USER_ID,
    updatedBy: SYSTEM_USER_ID,
  });
});
```

`apps/platform/src/database/seeds/1722335726360-account-seeder.ts`:

```ts
import { AccountEntity } from '@/api/account/entities/account.entity';
import { SYSTEM_USER_ID } from '@/constants/app.constant';
import { DataSource } from 'typeorm';
import { Seeder, SeederFactoryManager } from 'typeorm-extension';

export class AccountSeeder1722335726360 implements Seeder {
  track = false;

  public async run(
    dataSource: DataSource,
    factoryManager: SeederFactoryManager,
  ): Promise<void> {
    const repository = dataSource.getRepository(AccountEntity);
    if (!(await repository.findOneBy({ email: 'admin@example.com' }))) {
      await repository.save(
        new AccountEntity({
          email: 'admin@example.com',
          password: '12345678',
          name: 'Admin',
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        }),
      );
    }
    await factoryManager.get(AccountEntity).saveMany(5);
  }
}
```

In `apps/platform/src/api/auth/auth.module.ts`:
- replace `import { UserEntity } from '../user/entities/user.entity';` and `import { UserModule } from '../user/user.module';` with `import { AccountEntity } from '../account/entities/account.entity';`;
- remove `UserModule,` from `imports`;
- change `TypeOrmModule.forFeature([UserEntity, RefreshTokenEntity])` to `TypeOrmModule.forFeature([AccountEntity, RefreshTokenEntity])`.

In `apps/platform/src/api/auth/auth.service.ts`:
- replace the `UserEntity` import with `import { AccountEntity } from '../account/entities/account.entity';`;
- rename the injected `userRepository: Repository<UserEntity>` to `accountRepository: Repository<AccountEntity>` (with `@InjectRepository(AccountEntity)`), and every `this.userRepository` with `this.accountRepository`;
- in `register`, replace the two `UserEntity` usages: use `AccountEntity.exists({ where: { email: dto.email } })`, and construct with `new AccountEntity({ email: dto.email, password: dto.password, name: dto.name ?? '', createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID })`.

In `apps/platform/src/api/auth/auth.service.spec.ts`, replace every `UserEntity` with `AccountEntity` and the import path with `'../account/entities/account.entity'`.

In `apps/platform/src/api/auth/dto/register.req.dto.ts`, add:
- the import `StringFieldOptional` (next to `EmailField, PasswordField`);
- the field:

```ts
  @StringFieldOptional({ maxLength: 100 })
  name?: string;
```

- [ ] **Step 6: Run all platform tests and the type check**

Run: `IN_IMAGE "pnpm exec jest --config apps/platform/jest.config.json && pnpm exec tsc -p apps/platform/tsconfig.app.json --noEmit"`
Expected: PASS, no type errors. `grep -rn "UserEntity\|PostEntity\|api/user\|api/post" apps/platform/src` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add -A apps/platform/src
git commit -m "feat(platform): account replaces user; add /accounts/me; remove posts" -m "Rename UserEntity to AccountEntity (name, phone, status per the platform ERD) and expose GET/PATCH /accounts/me. Remove the /users routes, which had no ownership checks, and the post boilerplate. Register accepts an optional name."
```

---

### Task 3: Tenancy entities and memberships

**Files:**
- Create: `apps/platform/src/api/tenant/entities/tenant.entity.ts`, `apps/platform/src/api/tenant/entities/account-tenant.entity.ts`, `apps/platform/src/api/branch/entities/branch.entity.ts`, `apps/platform/src/api/tenant/membership.service.ts`, `apps/platform/src/api/tenant/membership.module.ts`
- Test: `apps/platform/src/api/tenant/membership.service.spec.ts`

**Interfaces:**
- Consumes: `AccountEntity` (Task 2).
- Produces:
  - `TenantEntity`; `enum TenantStatus { ACTIVE = 'active', SUSPENDED = 'suspended' }`;
  - `AccountTenantEntity`; `enum TenantRole { OWNER = 'owner' }`;
  - `BranchEntity`; `enum BranchStatus { ACTIVE = 'active', INACTIVE = 'inactive' }`; `DEFAULT_BRANCH = { code: 'CN01', name: 'Chi nhánh chính' }`;
  - `type Membership = { tenantId: string; name: string; subdomain: string; role: TenantRole }`;
  - `MembershipService.findActiveMemberships(accountId: string): Promise<Membership[]>`;
  - `MembershipService.findActiveMembership(accountId: string, tenantId: string): Promise<Membership | null>`;
  - `MembershipModule` exporting `MembershipService`.

- [ ] **Step 1: Write the failing test**

`apps/platform/src/api/tenant/membership.service.spec.ts`:

```ts
import { IsNull, Repository } from 'typeorm';
import { AccountTenantEntity, TenantRole } from './entities/account-tenant.entity';
import { TenantEntity, TenantStatus } from './entities/tenant.entity';
import { MembershipService } from './membership.service';

const row = (tenantId: string, name: string) =>
  new AccountTenantEntity({
    accountId: 'a1',
    tenantId,
    role: TenantRole.OWNER,
    tenant: new TenantEntity({ id: tenantId as TenantEntity['id'], name, subdomain: name.toLowerCase() }),
  });

describe('MembershipService', () => {
  let repository: { find: jest.Mock };
  let service: MembershipService;

  beforeEach(() => {
    repository = { find: jest.fn() };
    service = new MembershipService(repository as unknown as Repository<AccountTenantEntity>);
  });

  it('only returns memberships of active, non-deleted stores, by name', async () => {
    repository.find.mockResolvedValue([row('t1', 'Alpha'), row('t2', 'Beta')]);

    const memberships = await service.findActiveMemberships('a1');

    expect(repository.find).toHaveBeenCalledWith({
      where: { accountId: 'a1', tenant: { status: TenantStatus.ACTIVE, deletedAt: IsNull() } },
      relations: { tenant: true },
      order: { tenant: { name: 'ASC' } },
    });
    expect(memberships).toEqual([
      { tenantId: 't1', name: 'Alpha', subdomain: 'alpha', role: 'owner' },
      { tenantId: 't2', name: 'Beta', subdomain: 'beta', role: 'owner' },
    ]);
  });

  it('finds one membership with the same filters', async () => {
    repository.find.mockResolvedValue([row('t2', 'Beta')]);

    await expect(service.findActiveMembership('a1', 't2')).resolves.toEqual({
      tenantId: 't2', name: 'Beta', subdomain: 'beta', role: 'owner',
    });
    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'a1', tenantId: 't2', tenant: { status: TenantStatus.ACTIVE, deletedAt: IsNull() } },
      }),
    );
  });

  it('returns null for a store the account does not belong to, or that is suspended/deleted', async () => {
    repository.find.mockResolvedValue([]);

    await expect(service.findActiveMembership('a1', 'tX')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `IN_IMAGE "pnpm exec jest --config apps/platform/jest.config.json membership"`
Expected: FAIL with "Cannot find module './membership.service'".

- [ ] **Step 3: Create the entities**

`apps/platform/src/api/tenant/entities/tenant.entity.ts`:

```ts
import { Uuid } from '@/common/types/common.type';
import { AbstractEntity } from '@/database/entities/abstract.entity';
import { Column, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum TenantStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

/** A store (ADR-0008). */
@Entity('tenant')
export class TenantEntity extends AbstractEntity {
  constructor(data?: Partial<TenantEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_tenant_id' })
  id!: Uuid;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 30 })
  @Index('UQ_tenant_subdomain', { where: '"deleted_at" IS NULL', unique: true })
  subdomain!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 20, default: TenantStatus.ACTIVE })
  status!: TenantStatus;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', default: null })
  deletedAt: Date;
}
```

`apps/platform/src/api/tenant/entities/account-tenant.entity.ts`:

```ts
import { AccountEntity } from '@/api/account/entities/account.entity';
import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Relation,
} from 'typeorm';
import { TenantEntity } from './tenant.entity';

export enum TenantRole {
  OWNER = 'owner',
}

/** Membership of an account in a store, with its role (ADR-0008). */
@Entity('account_tenant')
export class AccountTenantEntity extends BaseEntity {
  constructor(data?: Partial<AccountTenantEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryColumn({ name: 'account_id', type: 'uuid', primaryKeyConstraintName: 'PK_account_tenant' })
  accountId!: string;

  @PrimaryColumn({ name: 'tenant_id', type: 'uuid', primaryKeyConstraintName: 'PK_account_tenant' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: TenantRole;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => AccountEntity)
  @JoinColumn({ name: 'account_id', foreignKeyConstraintName: 'FK_account_tenant_account' })
  account?: Relation<AccountEntity>;

  @ManyToOne(() => TenantEntity)
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_account_tenant_tenant' })
  tenant?: Relation<TenantEntity>;
}
```

`apps/platform/src/api/branch/entities/branch.entity.ts`:

```ts
import { TenantEntity } from '@/api/tenant/entities/tenant.entity';
import { Uuid } from '@/common/types/common.type';
import { AbstractEntity } from '@/database/entities/abstract.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';

export enum BranchStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/** Created with every new store (P0 spec, flow 2). */
export const DEFAULT_BRANCH = { code: 'CN01', name: 'Chi nhánh chính' } as const;

@Entity('branch')
@Index('UQ_branch_tenant_code', ['tenantId', 'code'], { unique: true, where: '"deleted_at" IS NULL' })
export class BranchEntity extends AbstractEntity {
  constructor(data?: Partial<BranchEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_branch_id' })
  id!: Uuid;

  @Index('IDX_branch_tenant_id')
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => TenantEntity)
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_branch_tenant' })
  tenant?: Relation<TenantEntity>;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ name: 'is_warehouse', type: 'boolean', default: true })
  isWarehouse!: boolean;

  @Column({ type: 'varchar', length: 20, default: BranchStatus.ACTIVE })
  status!: BranchStatus;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', default: null })
  deletedAt: Date;
}
```

- [ ] **Step 4: Create the membership service and module**

`apps/platform/src/api/tenant/membership.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { AccountTenantEntity, TenantRole } from './entities/account-tenant.entity';
import { TenantStatus } from './entities/tenant.entity';

export type Membership = {
  tenantId: string;
  name: string;
  subdomain: string;
  role: TenantRole;
};

/**
 * The stores an account can act in. Suspended and deleted stores are
 * excluded, so callers treat them exactly like non-members (404).
 */
@Injectable()
export class MembershipService {
  constructor(
    @InjectRepository(AccountTenantEntity)
    private readonly repository: Repository<AccountTenantEntity>,
  ) {}

  findActiveMemberships(accountId: string): Promise<Membership[]> {
    return this.find({ accountId });
  }

  async findActiveMembership(accountId: string, tenantId: string): Promise<Membership | null> {
    const [membership] = await this.find({ accountId, tenantId });
    return membership ?? null;
  }

  private async find(where: FindOptionsWhere<AccountTenantEntity>): Promise<Membership[]> {
    const rows = await this.repository.find({
      where: { ...where, tenant: { status: TenantStatus.ACTIVE, deletedAt: IsNull() } },
      relations: { tenant: true },
      order: { tenant: { name: 'ASC' } },
    });
    return rows.map((row) => ({
      tenantId: row.tenantId,
      name: row.tenant.name,
      subdomain: row.tenant.subdomain,
      role: row.role,
    }));
  }
}
```

`apps/platform/src/api/tenant/membership.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountTenantEntity } from './entities/account-tenant.entity';
import { MembershipService } from './membership.service';

/** Shared by AuthModule and TenantModule; avoids a module cycle. */
@Module({
  imports: [TypeOrmModule.forFeature([AccountTenantEntity])],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `IN_IMAGE "pnpm exec jest --config apps/platform/jest.config.json membership"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/platform/src/api/tenant apps/platform/src/api/branch
git commit -m "feat(platform): tenant, membership and branch entities" -m "Add TenantEntity, AccountTenantEntity and BranchEntity per the platform ERD, and MembershipService, which lists the active stores an account belongs to; suspended or deleted stores are excluded."
```

---

### Task 4: Tokens carry the store; tenant-aware sign-in, switch and refresh

**Files:**
- Modify: `apps/platform/src/api/auth/access-token.service.ts`, `apps/platform/src/api/auth/refresh-token.service.ts`, `apps/platform/src/api/auth/auth.service.ts`, `apps/platform/src/api/auth/auth.controller.ts`, `apps/platform/src/api/auth/auth.module.ts`, `apps/platform/src/api/auth/dto/login.req.dto.ts`, `apps/platform/src/api/auth/dto/login.res.dto.ts`
- Create: `apps/platform/src/api/auth/dto/switch-tenant.req.dto.ts`, `apps/platform/src/api/tenant/dto/membership.res.dto.ts`
- Test: `apps/platform/src/api/auth/access-token.service.spec.ts`, `apps/platform/src/api/auth/refresh-token.service.spec.ts`, `apps/platform/src/api/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `MembershipService`, `Membership`, `MembershipModule` (Task 3); `AccountEntity`, `AccountStatus` (Task 2); `AuthUser` with `tenantId`/`roles` (Task 1).
- Produces:
  - `AccessTokenService.sign(data: { userId: string; sessionId: string; tenantId?: string; roles?: string[] }): Promise<string>`;
  - `RefreshTokenService.issue(subjectId: string, tenantId?: string | null): Promise<{ token; familyId }>`;
  - `RefreshTokenService.rotate(token)` now also returns `tenantId: string | null`;
  - `AuthService.signIn(dto: LoginReqDto): Promise<LoginResDto>`;
  - `AuthService.switchTenant(user: AuthUser, tenantId: string): Promise<LoginResDto>`;
  - `MembershipResDto { id; name; subdomain; role }`;
  - `LoginResDto { userId; accessToken; refreshToken; tokenExpires; tenantId: string | null; tenants: MembershipResDto[] }`;
  - `AuthModule` exports `AuthService`;
  - route `POST /api/v1/auth/switch-tenant`.

- [ ] **Step 1: Write the failing token tests**

In `apps/platform/src/api/auth/access-token.service.spec.ts`, inside `describe('sign', …)` add:

```ts
    it('should add tid and roles when a store is selected', async () => {
      const token = await service.sign({ userId: 'user-1', sessionId: 'session-1', tenantId: 'tenant-1', roles: ['owner'] });

      expect(jwtService.decode(token)).toMatchObject({ tid: 'tenant-1', roles: ['owner'] });
    });

    it('should omit tid and send empty roles without a store', async () => {
      const claims = jwtService.decode(await service.sign({ userId: 'user-1', sessionId: 'session-1' }));

      expect(claims).not.toHaveProperty('tid');
      expect(claims.roles).toEqual([]);
    });
```

In `apps/platform/src/api/auth/refresh-token.service.spec.ts`:
- add `tenantId: null,` to the object returned by `storedRow`;
- inside `describe('issue', …)` add:

```ts
    it('should store the selected store on the token row', async () => {
      await service.issue('user-1', 'tenant-1');

      expect(repository.save.mock.calls[0][0]).toMatchObject({ tenantId: 'tenant-1' });
    });
```

- inside `describe('rotate', …)` add:

```ts
    it('should keep the store when rotating', async () => {
      repository.findOneBy.mockResolvedValue(storedRow({ tenantId: 'tenant-1' as never }));

      const rotated = await service.rotate('presented-token');

      expect(transactionManager.save.mock.calls[0][0]).toMatchObject({ tenantId: 'tenant-1' });
      expect(rotated.tenantId).toBe('tenant-1');
    });
```

- [ ] **Step 2: Write the failing auth-flow tests**

In `apps/platform/src/api/auth/auth.service.spec.ts`:
- add `jest.mock('@/utils/password.util', () => ({ verifyPassword: jest.fn() }));` at the top (after the imports), plus `import { verifyPassword } from '@/utils/password.util';`, `import { NotFoundException, UnauthorizedException } from '@nestjs/common';`, `import { AccountStatus } from '../account/entities/account.entity';` and `import { MembershipService } from '../tenant/membership.service';`;
- declare `let membershipServiceValue: { findActiveMemberships: jest.Mock; findActiveMembership: jest.Mock };`;
- in `beforeAll` set `membershipServiceValue = { findActiveMemberships: jest.fn(), findActiveMembership: jest.fn() };` and register `{ provide: MembershipService, useValue: membershipServiceValue }`;
- add these suites before the closing `});`:

```ts
  const alpha = { tenantId: 't1', name: 'Alpha', subdomain: 'alpha', role: 'owner' };
  const beta = { tenantId: 't2', name: 'Beta', subdomain: 'beta', role: 'owner' };
  const caller = { id: 'a1', sessionId: 'family-old', subjectType: 'account' as const, roles: [], exp: Math.floor(Date.now() / 1000) + 600 };

  describe('signIn', () => {
    const login = (tenantId?: string) => service.signIn({ email: 'me@example.com', password: 'Passw0rd!', tenantId });

    beforeEach(() => {
      userRepositoryValue.findOne = jest.fn().mockResolvedValue({ id: 'a1', password: 'hash', status: AccountStatus.ACTIVE });
      (verifyPassword as jest.Mock).mockResolvedValue(true);
      refreshTokenServiceValue.issue.mockResolvedValue({ token: 'rt', familyId: 'family-1' });
      accessTokenServiceValue.sign.mockResolvedValue('at');
    });

    it('selects the only store automatically', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([alpha]);

      const res = await login();

      expect(refreshTokenServiceValue.issue).toHaveBeenCalledWith('a1', 't1');
      expect(accessTokenServiceValue.sign).toHaveBeenCalledWith({ userId: 'a1', sessionId: 'family-1', tenantId: 't1', roles: ['owner'] });
      expect(res).toMatchObject({ userId: 'a1', accessToken: 'at', refreshToken: 'rt', tenantId: 't1' });
      expect(res.tenants).toEqual([{ id: 't1', name: 'Alpha', subdomain: 'alpha', role: 'owner' }]);
    });

    it('selects none with several stores and returns the list', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([alpha, beta]);

      const res = await login();

      expect(refreshTokenServiceValue.issue).toHaveBeenCalledWith('a1', null);
      expect(accessTokenServiceValue.sign).toHaveBeenCalledWith({ userId: 'a1', sessionId: 'family-1', tenantId: undefined, roles: [] });
      expect(res.tenantId).toBeNull();
      expect(res.tenants).toHaveLength(2);
    });

    it('selects none without stores', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([]);

      await expect(login()).resolves.toMatchObject({ tenantId: null, tenants: [] });
    });

    it('selects the requested store', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([alpha, beta]);

      await expect(login('t2')).resolves.toMatchObject({ tenantId: 't2' });
    });

    it('answers 404 for a store the account cannot use (non-member, suspended or deleted)', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([alpha]);

      await expect(login('t9')).rejects.toThrow(NotFoundException);
      expect(refreshTokenServiceValue.issue).not.toHaveBeenCalled();
    });

    it('rejects a disabled account like a wrong password', async () => {
      userRepositoryValue.findOne = jest.fn().mockResolvedValue({ id: 'a1', password: 'hash', status: AccountStatus.DISABLED });

      await expect(login()).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('switchTenant', () => {
    beforeEach(() => {
      refreshTokenServiceValue.issue.mockResolvedValue({ token: 'rt2', familyId: 'family-2' });
      accessTokenServiceValue.sign.mockResolvedValue('at2');
    });

    it('revokes the current session and starts one in the requested store', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([alpha, beta]);

      const res = await service.switchTenant(caller, 't2');

      expect(cacheManagerValue.store.set).toHaveBeenCalledWith(expect.stringContaining('family-old'), true, expect.any(Number));
      expect(refreshTokenServiceValue.revokeFamily).toHaveBeenCalledWith('family-old');
      expect(refreshTokenServiceValue.issue).toHaveBeenCalledWith('a1', 't2');
      expect(res).toMatchObject({ accessToken: 'at2', tenantId: 't2' });
    });

    it('answers 404 for a store the caller cannot use, and keeps the current session', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([alpha]);

      await expect(service.switchTenant(caller, 't9')).rejects.toThrow(NotFoundException);
      expect(refreshTokenServiceValue.revokeFamily).not.toHaveBeenCalled();
    });
  });

  describe('refreshToken with a store', () => {
    beforeEach(() => {
      refreshTokenServiceValue.rotate.mockResolvedValue({ token: 'next', familyId: 'family-1', subjectId: 'a1', tenantId: 't1' });
      userRepositoryValue.findOne = jest.fn().mockResolvedValue({ id: 'a1', status: AccountStatus.ACTIVE });
      accessTokenServiceValue.sign.mockResolvedValue('at');
    });

    it('keeps the store and re-reads the role', async () => {
      membershipServiceValue.findActiveMembership.mockResolvedValue(alpha);

      await service.refreshToken({ refreshToken: 'presented' });

      expect(membershipServiceValue.findActiveMembership).toHaveBeenCalledWith('a1', 't1');
      expect(accessTokenServiceValue.sign).toHaveBeenCalledWith({ userId: 'a1', sessionId: 'family-1', tenantId: 't1', roles: ['owner'] });
    });

    it('ends the session when the membership is gone', async () => {
      membershipServiceValue.findActiveMembership.mockResolvedValue(null);

      await expect(service.refreshToken({ refreshToken: 'presented' })).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenServiceValue.revokeFamily).toHaveBeenCalledWith('family-1');
      expect(accessTokenServiceValue.sign).not.toHaveBeenCalled();
    });

    it('ends the session for a disabled account', async () => {
      userRepositoryValue.findOne = jest.fn().mockResolvedValue({ id: 'a1', status: AccountStatus.DISABLED });

      await expect(service.refreshToken({ refreshToken: 'presented' })).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenServiceValue.revokeFamily).toHaveBeenCalledWith('family-1');
    });
  });
```

In the existing "should rotate the refresh token…" test, add `tenantId: null` to the `rotate` mock result, and change the expected `sign` call to `{ userId: 'user-1', sessionId: 'family-1', tenantId: undefined, roles: [] }`. In "should revoke the family and reject when the user no longer exists", add `tenantId: null` to the `rotate` mock result.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `IN_IMAGE "pnpm exec jest --config apps/platform/jest.config.json auth refresh-token access-token"`
Expected: FAIL (`switchTenant` is not a function; no `tid`; `issue` called without a tenant).

- [ ] **Step 4: Tokens carry the store**

In `apps/platform/src/api/auth/access-token.service.ts`, replace `sign`:

```ts
  async sign(data: {
    userId: string;
    sessionId: string;
    tenantId?: string;
    roles?: string[];
  }): Promise<string> {
    const subjectType: AccessTokenSubjectType = 'account';
    return this.jwtService.signAsync(
      {
        sub: data.userId,
        sid: data.sessionId,
        sub_type: subjectType,
        ...(data.tenantId ? { tid: data.tenantId } : {}),
        roles: data.roles ?? [],
      },
      {
        privateKey: this.privateKeyPem,
        algorithm: ALGORITHM,
        keyid: this.keyId,
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: this.expiresIn,
      },
    );
  }
```

In `apps/platform/src/api/auth/refresh-token.service.ts`:
- `issue(subjectId: Uuid | string, tenantId: string | null = null)` calls `this.store(this.repository, familyId, subjectId, tenantId)`;
- `rotate`'s return type gains `tenantId: string | null`; inside the transaction call `this.store(em, current.familyId, current.subjectId, current.tenantId)`; the final return becomes `return { token, familyId: current.familyId, subjectId: current.subjectId, tenantId: current.tenantId };`;
- `store(repository, familyId, subjectId, tenantId: string | null)` sets `tenantId: tenantId as Uuid | null` instead of `tenantId: null`.

- [ ] **Step 5: Membership DTO, login DTOs, switch DTO**

`apps/platform/src/api/tenant/dto/membership.res.dto.ts`:

```ts
import { EnumField, StringField } from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { TenantRole } from '../entities/account-tenant.entity';

/** A store the caller belongs to, with the caller's role in it. */
@Exclude()
export class MembershipResDto {
  @StringField() @Expose() id: string;
  @StringField() @Expose() name: string;
  @StringField() @Expose() subdomain: string;
  @EnumField(() => TenantRole) @Expose() role: TenantRole;
}
```

`apps/platform/src/api/auth/dto/login.res.dto.ts`, add the two fields after `tokenExpires` (imports: `ClassField, StringFieldOptional` and `MembershipResDto` from `'../../tenant/dto/membership.res.dto'`):

```ts
  /** Selected store, or null when the caller must pick or create one */
  @Expose()
  @StringFieldOptional({ nullable: true })
  tenantId!: string | null;

  @Expose()
  @ClassField(() => MembershipResDto, { each: true, isArray: true })
  tenants!: MembershipResDto[];
```

`apps/platform/src/api/auth/dto/login.req.dto.ts`, add (import `UUIDFieldOptional`):

```ts
  /** Store to select; omitted → the only store, or none */
  @UUIDFieldOptional()
  tenantId?: string;
```

`apps/platform/src/api/auth/dto/switch-tenant.req.dto.ts`:

```ts
import { UUIDField } from '@/decorators/field.decorators';

export class SwitchTenantReqDto {
  @UUIDField()
  tenantId!: string;
}
```

- [ ] **Step 6: Tenant-aware AuthService**

In `apps/platform/src/api/auth/auth.service.ts`:
- add the imports `NotFoundException`; `AccountStatus` from `'../account/entities/account.entity'`; `Membership, MembershipService` from `'../tenant/membership.service'`;
- inject `private readonly membershipService: MembershipService,` (after `refreshTokenService`);
- replace `signIn`:

```ts
  async signIn(dto: LoginReqDto): Promise<LoginResDto> {
    const account = await this.accountRepository.findOne({
      where: { email: dto.email },
      select: ['id', 'email', 'password', 'status'],
    });
    const isValid =
      account?.status === AccountStatus.ACTIVE &&
      (await verifyPassword(dto.password, account.password));
    if (!isValid) {
      throw new UnauthorizedException();
    }

    const memberships = await this.membershipService.findActiveMemberships(account.id);
    let selected: Membership | null = null;
    if (dto.tenantId) {
      selected = memberships.find((m) => m.tenantId === dto.tenantId) ?? null;
      if (!selected) throw new NotFoundException();
    } else if (memberships.length === 1) {
      selected = memberships[0];
    }
    return this.startSession(account.id, selected, memberships);
  }

  /**
   * Select another store: end the current session (its access tokens stop
   * working immediately) and start one bound to the store (P0 spec, flow 4).
   */
  async switchTenant(user: AuthUser, tenantId: string): Promise<LoginResDto> {
    const memberships = await this.membershipService.findActiveMemberships(user.id);
    const selected = memberships.find((m) => m.tenantId === tenantId);
    if (!selected) {
      throw new NotFoundException();
    }
    await this.revokeSession(user.sessionId, user.exp * 1000 - Date.now());
    return this.startSession(user.id, selected, memberships);
  }

  private async startSession(
    accountId: string,
    selected: Membership | null,
    memberships: Membership[],
  ): Promise<LoginResDto> {
    // One refresh-token family per login; its id is the access token's sid
    const { token: refreshToken, familyId } = await this.refreshTokenService.issue(
      accountId,
      selected?.tenantId ?? null,
    );
    const token = await this.createToken({
      id: accountId,
      sessionId: familyId,
      refreshToken,
      membership: selected,
    });
    return plainToInstance(LoginResDto, {
      userId: accountId,
      ...token,
      tenantId: selected?.tenantId ?? null,
      tenants: memberships.map((m) => ({ id: m.tenantId, name: m.name, subdomain: m.subdomain, role: m.role })),
    });
  }
```

- in `refreshToken`, replace everything from `const user = await this.accountRepository.findOne(` to the end of the method with:

```ts
    const account = await this.accountRepository.findOne({
      where: { id: rotated.subjectId },
      select: ['id', 'status'],
    });
    if (!account || account.status !== AccountStatus.ACTIVE) {
      await this.refreshTokenService.revokeFamily(rotated.familyId);
      throw new UnauthorizedException();
    }

    let membership: Membership | null = null;
    if (rotated.tenantId) {
      membership = await this.membershipService.findActiveMembership(account.id, rotated.tenantId);
      if (!membership) {
        // Removed from the store, or the store was suspended: end the session
        const accessTokenLifetime: string = this.configService.getOrThrow('auth.expires', { infer: true });
        await this.revokeSession(rotated.familyId, ms(accessTokenLifetime));
        throw new UnauthorizedException();
      }
    }

    return await this.createToken({
      id: account.id,
      sessionId: rotated.familyId,
      refreshToken: rotated.token,
      membership,
    });
```

- in `createToken`, add `membership: Membership | null;` to the parameter type, and change the `sign` call to:

```ts
    const accessToken = await this.accessTokenService.sign({
      userId: data.id,
      sessionId: data.sessionId,
      tenantId: data.membership?.tenantId,
      roles: data.membership ? [data.membership.role] : [],
    });
```

- [ ] **Step 7: Route and module**

In `apps/platform/src/api/auth/auth.controller.ts`, add (import `SwitchTenantReqDto`):

```ts
  @ApiAuth({
    type: LoginResDto,
    summary: 'Switch to another store (new token pair)',
    errorResponses: [401, 404, 422],
  })
  @Post('switch-tenant')
  async switchTenant(
    @CurrentUser() user: AuthUser,
    @Body() dto: SwitchTenantReqDto,
  ): Promise<LoginResDto> {
    return await this.authService.switchTenant(user, dto.tenantId);
  }
```

In `apps/platform/src/api/auth/auth.module.ts`:
- add `MembershipModule` (from `'../tenant/membership.module'`) to `imports`;
- add `exports: [AuthService],`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `IN_IMAGE "pnpm exec jest --config apps/platform/jest.config.json && pnpm exec tsc -p apps/platform/tsconfig.app.json --noEmit"`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add apps/platform/src/api/auth apps/platform/src/api/tenant/dto
git commit -m "feat(platform): tokens carry the selected store; switch-tenant" -m "Login selects the only store or the requested one (404 if the caller cannot use it), returns tenantId and the store list, and keeps userId. POST /auth/switch-tenant ends the current session and starts one bound to the store. Refresh keeps the store, re-reads the role, and ends the session when the membership is gone or the account is disabled."
```

---

### Task 5: Tenants API

**Files:**
- Create: `apps/platform/src/utils/db-errors.ts`, `apps/platform/src/api/tenant/tenant.service.ts`, `apps/platform/src/api/tenant/tenant.controller.ts`, `apps/platform/src/api/tenant/tenant.module.ts`, `apps/platform/src/api/tenant/dto/create-tenant.req.dto.ts`, `apps/platform/src/api/tenant/dto/update-tenant.req.dto.ts`, `apps/platform/src/api/tenant/dto/tenant.res.dto.ts`, `apps/platform/src/api/tenant/dto/create-tenant.res.dto.ts`, `apps/platform/src/i18n/{en,vi,jp}/tenant.json`
- Modify: `apps/platform/src/constants/error-code.constant.ts`, `apps/platform/src/generated/i18n.generated.ts`, `apps/platform/src/api/api.module.ts`
- Test: `apps/platform/src/utils/db-errors.spec.ts`, `apps/platform/src/api/tenant/tenant.service.spec.ts`, `apps/platform/src/api/tenant/dto/create-tenant.req.dto.spec.ts`

**Interfaces:**
- Consumes: entities (Task 3), `MembershipService` (Task 3), `AuthService.switchTenant`, `MembershipResDto`, `LoginResDto` (Task 4).
- Produces:
  - `isUniqueViolation(error: unknown, constraint: string): boolean`;
  - `ErrorCode.T001`;
  - `TenantService.create(accountId: string, dto: CreateTenantReqDto): Promise<TenantEntity>`;
  - routes `GET/POST /api/v1/tenants`, `GET/PATCH /api/v1/tenants/current`.

- [ ] **Step 1: Write the failing tests**

`apps/platform/src/utils/db-errors.spec.ts`:

```ts
import { QueryFailedError } from 'typeorm';
import { isUniqueViolation } from './db-errors';

const pgError = (code: string, constraint: string) =>
  new QueryFailedError('INSERT …', [], Object.assign(new Error('dup'), { code, constraint }));

describe('isUniqueViolation', () => {
  it('matches a unique violation on the named constraint', () => {
    expect(isUniqueViolation(pgError('23505', 'UQ_tenant_subdomain'), 'UQ_tenant_subdomain')).toBe(true);
  });

  it('ignores other constraints, other errors and non-errors', () => {
    expect(isUniqueViolation(pgError('23505', 'UQ_other'), 'UQ_tenant_subdomain')).toBe(false);
    expect(isUniqueViolation(pgError('23503', 'UQ_tenant_subdomain'), 'UQ_tenant_subdomain')).toBe(false);
    expect(isUniqueViolation(new Error('x'), 'UQ_tenant_subdomain')).toBe(false);
    expect(isUniqueViolation(undefined, 'UQ_tenant_subdomain')).toBe(false);
  });
});
```

`apps/platform/src/api/tenant/dto/create-tenant.req.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTenantReqDto } from './create-tenant.req.dto';

const build = (subdomain: unknown) =>
  plainToInstance(CreateTenantReqDto, { name: 'My Shop', subdomain });

describe('CreateTenantReqDto', () => {
  it('trims and lowercases the subdomain', async () => {
    const dto = build('  My-Shop ');

    expect(dto.subdomain).toBe('my-shop');
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['ab', 'a'.repeat(31), '-shop', 'shop-', 'my_shop', 'my shop', 'cửa-hàng'])(
    'rejects the invalid subdomain %p',
    async (subdomain) => {
      const errors = await validate(build(subdomain));
      expect(errors.map((e) => e.property)).toContain('subdomain');
    },
  );

  it.each(['www', 'api', 'admin', 'app', 'static', 'platform', 'catalog', 'commerce', 'finance', 'insight', 'integration'])(
    'rejects the reserved subdomain %p',
    async (subdomain) => {
      const errors = await validate(build(subdomain));
      expect(errors.map((e) => e.property)).toContain('subdomain');
    },
  );
});
```

`apps/platform/src/api/tenant/tenant.service.spec.ts`:

```ts
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { BranchEntity } from '../branch/entities/branch.entity';
import { AccountTenantEntity } from './entities/account-tenant.entity';
import { TenantEntity } from './entities/tenant.entity';
import { MembershipService } from './membership.service';
import { TenantService } from './tenant.service';

describe('TenantService.create', () => {
  const dto = { name: 'My Shop', subdomain: 'my-shop' };
  let tenantRepository: { exists: jest.Mock };
  let saved: unknown[];
  let dataSource: { transaction: jest.Mock };
  let service: TenantService;

  beforeEach(() => {
    saved = [];
    tenantRepository = { exists: jest.fn().mockResolvedValue(false) };
    const em = {
      save: jest.fn(async (entity) => {
        saved.push(entity);
        if (entity instanceof TenantEntity) entity.id = 't1' as TenantEntity['id'];
        return entity;
      }),
    };
    dataSource = { transaction: jest.fn((work) => work(em)) };
    service = new TenantService(
      tenantRepository as unknown as Repository<TenantEntity>,
      dataSource as unknown as DataSource,
      {} as MembershipService,
    );
  });

  it('creates the store, the owner membership and the default branch in one transaction', async () => {
    const tenant = await service.create('a1', dto);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(tenant.id).toBe('t1');
    expect(saved[0]).toBeInstanceOf(TenantEntity);
    expect(saved[0]).toMatchObject({ name: 'My Shop', subdomain: 'my-shop', status: 'active', createdBy: 'a1' });
    expect(saved[1]).toBeInstanceOf(AccountTenantEntity);
    expect(saved[1]).toMatchObject({ accountId: 'a1', tenantId: 't1', role: 'owner' });
    expect(saved[2]).toBeInstanceOf(BranchEntity);
    expect(saved[2]).toMatchObject({ tenantId: 't1', code: 'CN01', name: 'Chi nhánh chính', isWarehouse: true, status: 'active' });
  });

  it('rejects a taken subdomain with T001', async () => {
    tenantRepository.exists.mockResolvedValue(true);

    const error = await service.create('a1', dto).catch((e) => e);

    expect(error).toBeInstanceOf(ValidationException);
    expect(error.getResponse()).toMatchObject({ errorCode: ErrorCode.T001 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('maps a concurrent duplicate (unique index) to T001, not a 500', async () => {
    dataSource.transaction.mockRejectedValue(
      new QueryFailedError('INSERT', [], Object.assign(new Error('dup'), { code: '23505', constraint: 'UQ_tenant_subdomain' })),
    );

    const error = await service.create('a1', dto).catch((e) => e);

    expect(error).toBeInstanceOf(ValidationException);
    expect(error.getResponse()).toMatchObject({ errorCode: ErrorCode.T001 });
  });

  it('rethrows other database errors', async () => {
    dataSource.transaction.mockRejectedValue(new Error('connection lost'));

    await expect(service.create('a1', dto)).rejects.toThrow('connection lost');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `IN_IMAGE "pnpm exec jest --config apps/platform/jest.config.json db-errors tenant"`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `isUniqueViolation`, the error code and messages**

`apps/platform/src/utils/db-errors.ts`:

```ts
import { QueryFailedError } from 'typeorm';

const PG_UNIQUE_VIOLATION = '23505';

/** True when a Postgres insert/update hit the named unique constraint/index. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string; constraint?: string };
  return driverError?.code === PG_UNIQUE_VIOLATION && driverError?.constraint === constraint;
}
```

In `apps/platform/src/constants/error-code.constant.ts`, add inside the enum after `E003`:

```ts

  // Tenant
  T001 = 'tenant.error.subdomain_exists',
```

Create `apps/platform/src/i18n/en/tenant.json`:

```json
{
  "error": {
    "subdomain_exists": "This subdomain is already taken"
  }
}
```

Create `apps/platform/src/i18n/vi/tenant.json`:

```json
{
  "error": {
    "subdomain_exists": "Tên miền phụ này đã được sử dụng"
  }
}
```

Create `apps/platform/src/i18n/jp/tenant.json`:

```json
{
  "error": {
    "subdomain_exists": "このサブドメインは既に使用されています"
  }
}
```

In `apps/platform/src/generated/i18n.generated.ts`, inside `I18nTranslations`, after the `"user": { … };` block, add:

```ts
    "tenant": {
        "error": {
            "subdomain_exists": string;
        };
    };
```

- [ ] **Step 4: DTOs**

`apps/platform/src/api/tenant/dto/create-tenant.req.dto.ts`:

```ts
import { EmailFieldOptional, StringField, StringFieldOptional } from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';
import { IsNotIn, Matches } from 'class-validator';

export const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
export const RESERVED_SUBDOMAINS = [
  'www', 'api', 'admin', 'app', 'static', 'platform',
  'catalog', 'commerce', 'finance', 'insight', 'integration',
];

export class CreateTenantReqDto {
  @StringField({ maxLength: 150 })
  name!: string;

  /** Lowercase letters, digits, hyphens; 3–30 chars; cannot change later */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @StringField({ minLength: 3, maxLength: 30 })
  @Matches(SUBDOMAIN_PATTERN)
  @IsNotIn(RESERVED_SUBDOMAINS)
  subdomain!: string;

  @StringFieldOptional({ maxLength: 20 })
  @Matches(/^\+?[0-9]{8,15}$/)
  phone?: string;

  @EmailFieldOptional()
  email?: string;

  @StringFieldOptional({ maxLength: 255 })
  address?: string;
}
```

`apps/platform/src/api/tenant/dto/update-tenant.req.dto.ts`:

```ts
import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateTenantReqDto } from './create-tenant.req.dto';

/** The subdomain cannot change. */
export class UpdateTenantReqDto extends PartialType(
  OmitType(CreateTenantReqDto, ['subdomain'] as const),
) {}
```

`apps/platform/src/api/tenant/dto/tenant.res.dto.ts`:

```ts
import { ClassField, EnumField, StringField, StringFieldOptional } from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { TenantStatus } from '../entities/tenant.entity';

@Exclude()
export class TenantResDto {
  @StringField() @Expose() id: string;
  @StringField() @Expose() name: string;
  @StringField() @Expose() subdomain: string;
  @StringFieldOptional({ nullable: true }) @Expose() phone: string | null;
  @StringFieldOptional({ nullable: true }) @Expose() email: string | null;
  @StringFieldOptional({ nullable: true }) @Expose() address: string | null;
  @EnumField(() => TenantStatus) @Expose() status: TenantStatus;
  @ClassField(() => Date) @Expose() createdAt: Date;
}
```

`apps/platform/src/api/tenant/dto/create-tenant.res.dto.ts`:

```ts
import { ClassField } from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { LoginResDto } from '../../auth/dto/login.res.dto';
import { TenantResDto } from './tenant.res.dto';

/** The new store, and a token pair already bound to it. */
@Exclude()
export class CreateTenantResDto {
  @ClassField(() => TenantResDto) @Expose() tenant: TenantResDto;
  @ClassField(() => LoginResDto) @Expose() auth: LoginResDto;
}
```

- [ ] **Step 5: Service, controller and module**

`apps/platform/src/api/tenant/tenant.service.ts`:

```ts
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BranchEntity, BranchStatus, DEFAULT_BRANCH } from '../branch/entities/branch.entity';
import { CreateTenantReqDto } from './dto/create-tenant.req.dto';
import { MembershipResDto } from './dto/membership.res.dto';
import { TenantResDto } from './dto/tenant.res.dto';
import { UpdateTenantReqDto } from './dto/update-tenant.req.dto';
import { AccountTenantEntity, TenantRole } from './entities/account-tenant.entity';
import { TenantEntity, TenantStatus } from './entities/tenant.entity';
import { MembershipService } from './membership.service';

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
    private readonly dataSource: DataSource,
    private readonly membershipService: MembershipService,
  ) {}

  async listMine(accountId: string): Promise<MembershipResDto[]> {
    const memberships = await this.membershipService.findActiveMemberships(accountId);
    return memberships.map((m) => ({ id: m.tenantId, name: m.name, subdomain: m.subdomain, role: m.role }));
  }

  /** Store + owner membership + default branch, atomically (P0 spec, flow 2). */
  async create(accountId: string, dto: CreateTenantReqDto): Promise<TenantEntity> {
    if (await this.tenantRepository.exists({ where: { subdomain: dto.subdomain } })) {
      throw new ValidationException(ErrorCode.T001);
    }
    try {
      return await this.dataSource.transaction(async (em) => {
        const tenant = await em.save(
          new TenantEntity({
            name: dto.name,
            subdomain: dto.subdomain,
            phone: dto.phone ?? null,
            email: dto.email ?? null,
            address: dto.address ?? null,
            status: TenantStatus.ACTIVE,
            createdBy: accountId,
            updatedBy: accountId,
          }),
        );
        await em.save(new AccountTenantEntity({ accountId, tenantId: tenant.id, role: TenantRole.OWNER }));
        await em.save(
          new BranchEntity({
            tenantId: tenant.id,
            code: DEFAULT_BRANCH.code,
            name: DEFAULT_BRANCH.name,
            isWarehouse: true,
            status: BranchStatus.ACTIVE,
            createdBy: accountId,
            updatedBy: accountId,
          }),
        );
        return tenant;
      });
    } catch (error) {
      // Two creations raced past the pre-check; the unique index decided
      if (isUniqueViolation(error, 'UQ_tenant_subdomain')) {
        throw new ValidationException(ErrorCode.T001);
      }
      throw error;
    }
  }

  async getCurrent(tenantId: string): Promise<TenantResDto> {
    const tenant = await this.tenantRepository.findOneByOrFail({ id: tenantId as TenantEntity['id'] });
    return tenant.toDto(TenantResDto);
  }

  async updateCurrent(tenantId: string, accountId: string, dto: UpdateTenantReqDto): Promise<TenantResDto> {
    const tenant = await this.tenantRepository.findOneByOrFail({ id: tenantId as TenantEntity['id'] });
    Object.assign(
      tenant,
      Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)),
    );
    tenant.updatedBy = accountId;
    return (await this.tenantRepository.save(tenant)).toDto(TenantResDto);
  }
}
```

`apps/platform/src/api/tenant/tenant.controller.ts`:

```ts
import { ApiAuth } from '@/decorators/http.decorators';
import { Body, Controller, Get, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentTenant, CurrentUser, RequireRoles } from '@pbl/auth';
import { plainToInstance } from 'class-transformer';
import { AuthService } from '../auth/auth.service';
import { CreateTenantReqDto } from './dto/create-tenant.req.dto';
import { CreateTenantResDto } from './dto/create-tenant.res.dto';
import { MembershipResDto } from './dto/membership.res.dto';
import { TenantResDto } from './dto/tenant.res.dto';
import { UpdateTenantReqDto } from './dto/update-tenant.req.dto';
import { TenantRole } from './entities/account-tenant.entity';
import { TenantService } from './tenant.service';

@ApiTags('tenants')
@Controller({ path: 'tenants', version: '1' })
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly authService: AuthService,
  ) {}

  @ApiAuth({ type: MembershipResDto, summary: 'Stores I belong to' })
  @Get()
  listMine(@CurrentUser('id') accountId: string): Promise<MembershipResDto[]> {
    return this.tenantService.listMine(accountId);
  }

  @ApiAuth({ type: CreateTenantResDto, summary: 'Create a store (returns tokens bound to it)', statusCode: HttpStatus.CREATED })
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateTenantReqDto): Promise<CreateTenantResDto> {
    const tenant = await this.tenantService.create(user.id, dto);
    const auth = await this.authService.switchTenant(user, tenant.id);
    return plainToInstance(CreateTenantResDto, { tenant: tenant.toDto(TenantResDto), auth });
  }

  @ApiAuth({ type: TenantResDto, summary: 'The selected store' })
  @Get('current')
  getCurrent(@CurrentTenant() tenantId: string): Promise<TenantResDto> {
    return this.tenantService.getCurrent(tenantId);
  }

  @ApiAuth({ type: TenantResDto, summary: 'Update the selected store (owner)' })
  @RequireRoles(TenantRole.OWNER)
  @Patch('current')
  updateCurrent(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') accountId: string,
    @Body() dto: UpdateTenantReqDto,
  ): Promise<TenantResDto> {
    return this.tenantService.updateCurrent(tenantId, accountId, dto);
  }
}
```

`apps/platform/src/api/tenant/tenant.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TenantEntity } from './entities/tenant.entity';
import { MembershipModule } from './membership.module';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity]), MembershipModule, AuthModule],
  controllers: [TenantController],
  providers: [TenantService],
})
export class TenantModule {}
```

In `apps/platform/src/api/api.module.ts`, import `TenantModule` from `'./tenant/tenant.module'` and add it to `imports`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `IN_IMAGE "pnpm exec jest --config apps/platform/jest.config.json && pnpm exec tsc -p apps/platform/tsconfig.app.json --noEmit"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/platform/src
git commit -m "feat(platform): tenants API (create store, list, current)" -m "POST /tenants creates the store, the owner membership and the default branch CN01 in one transaction and returns tokens bound to the new store. Duplicate subdomains answer 400 T001, including a race caught by the unique index. GET /tenants lists the caller's stores; GET/PATCH /tenants/current read and update the selected one (owner only for PATCH)."
```

---

### Task 6: Branches API

**Files:**
- Create: `apps/platform/src/api/branch/branch.service.ts`, `apps/platform/src/api/branch/branch.controller.ts`, `apps/platform/src/api/branch/branch.module.ts`, `apps/platform/src/api/branch/dto/create-branch.req.dto.ts`, `apps/platform/src/api/branch/dto/update-branch.req.dto.ts`, `apps/platform/src/api/branch/dto/list-branch.req.dto.ts`, `apps/platform/src/api/branch/dto/branch.res.dto.ts`, `apps/platform/src/i18n/{en,vi,jp}/branch.json`
- Modify: `apps/platform/src/constants/error-code.constant.ts`, `apps/platform/src/generated/i18n.generated.ts`, `apps/platform/src/api/api.module.ts`
- Test: `apps/platform/src/api/branch/branch.service.spec.ts`

**Interfaces:**
- Consumes: `BranchEntity`, `BranchStatus` (Task 3); `isUniqueViolation` (Task 5); `CurrentTenant`, `RequireRoles` (Task 1); `TenantRole` (Task 3).
- Produces: `ErrorCode.B001`, `ErrorCode.B002`; routes `GET/POST /api/v1/branches`, `GET/PATCH/DELETE /api/v1/branches/{id}`.

- [ ] **Step 1: Write the failing test**

`apps/platform/src/api/branch/branch.service.spec.ts`:

```ts
import { ErrorCode } from '@/constants/error-code.constant';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BranchService } from './branch.service';
import { BranchEntity, BranchStatus } from './entities/branch.entity';

const branch = (overrides: Partial<BranchEntity> = {}) =>
  new BranchEntity({
    id: 'b1' as BranchEntity['id'],
    tenantId: 't1',
    code: 'CN01',
    name: 'Main',
    status: BranchStatus.ACTIVE,
    isWarehouse: true,
    ...overrides,
  });

describe('BranchService', () => {
  let repository: { findOne: jest.Mock; exists: jest.Mock; count: jest.Mock; save: jest.Mock; softDelete: jest.Mock };
  let service: BranchService;
  const errorCodeOf = (promise: Promise<unknown>) => promise.catch((e) => e.getResponse().errorCode);

  beforeEach(() => {
    repository = {
      findOne: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      count: jest.fn().mockResolvedValue(2),
      save: jest.fn(async (e) => e),
      softDelete: jest.fn(),
    };
    service = new BranchService(repository as unknown as Repository<BranchEntity>);
  });

  it('looks branches up within the tenant only', async () => {
    repository.findOne.mockResolvedValue(branch());

    await service.get('t1', 'b1');

    expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 'b1', tenantId: 't1' } });
  });

  it("answers 404 for another tenant's branch", async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.get('t2', 'b1')).rejects.toThrow(NotFoundException);
  });

  it('creates a branch in the caller tenant', async () => {
    const created = await service.create('t1', 'a1', { name: 'Kho 2', code: 'KHO2' });

    expect(repository.exists).toHaveBeenCalledWith({ where: { tenantId: 't1', code: 'KHO2' } });
    expect(repository.save.mock.calls[0][0]).toMatchObject({ tenantId: 't1', code: 'KHO2', isWarehouse: true, status: 'active', createdBy: 'a1' });
    expect(created).toMatchObject({ code: 'KHO2', name: 'Kho 2' });
  });

  it('rejects a duplicate code in the tenant with B001', async () => {
    repository.exists.mockResolvedValue(true);

    await expect(errorCodeOf(service.create('t1', 'a1', { name: 'X', code: 'CN01' }))).resolves.toBe(ErrorCode.B001);
  });

  it('refuses to delete the last active branch with B002', async () => {
    repository.findOne.mockResolvedValue(branch());
    repository.count.mockResolvedValue(1);

    await expect(errorCodeOf(service.remove('t1', 'b1'))).resolves.toBe(ErrorCode.B002);
    expect(repository.softDelete).not.toHaveBeenCalled();
  });

  it('refuses to deactivate the last active branch with B002', async () => {
    repository.findOne.mockResolvedValue(branch());
    repository.count.mockResolvedValue(1);

    await expect(errorCodeOf(service.update('t1', 'a1', 'b1', { status: BranchStatus.INACTIVE }))).resolves.toBe(ErrorCode.B002);
  });

  it('deletes an inactive branch even if only one active branch remains', async () => {
    repository.findOne.mockResolvedValue(branch({ status: BranchStatus.INACTIVE }));
    repository.count.mockResolvedValue(1);

    await service.remove('t1', 'b1');

    expect(repository.softDelete).toHaveBeenCalledWith({ id: 'b1', tenantId: 't1' });
  });

  it('rejects renaming the code to one already used in the tenant', async () => {
    repository.findOne.mockResolvedValue(branch());
    repository.exists.mockResolvedValue(true);

    await expect(errorCodeOf(service.update('t1', 'a1', 'b1', { code: 'KHO2' }))).resolves.toBe(ErrorCode.B001);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `IN_IMAGE "pnpm exec jest --config apps/platform/jest.config.json branch"`
Expected: FAIL with "Cannot find module './branch.service'".

- [ ] **Step 3: Error codes and messages**

In `apps/platform/src/constants/error-code.constant.ts`, after `T001`:

```ts

  // Branch
  B001 = 'branch.error.code_exists',
  B002 = 'branch.error.last_branch',
```

Create `apps/platform/src/i18n/en/branch.json`:

```json
{
  "error": {
    "code_exists": "A branch with this code already exists",
    "last_branch": "A store must keep at least one active branch"
  }
}
```

Create `apps/platform/src/i18n/vi/branch.json`:

```json
{
  "error": {
    "code_exists": "Mã chi nhánh này đã tồn tại",
    "last_branch": "Cửa hàng phải còn ít nhất một chi nhánh đang hoạt động"
  }
}
```

Create `apps/platform/src/i18n/jp/branch.json`:

```json
{
  "error": {
    "code_exists": "このコードの支店は既に存在します",
    "last_branch": "店舗には少なくとも1つの有効な支店が必要です"
  }
}
```

In `apps/platform/src/generated/i18n.generated.ts`, after the `"tenant"` block add:

```ts
    "branch": {
        "error": {
            "code_exists": string;
            "last_branch": string;
        };
    };
```

- [ ] **Step 4: DTOs**

`apps/platform/src/api/branch/dto/create-branch.req.dto.ts`:

```ts
import { BooleanFieldOptional, StringField, StringFieldOptional } from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

export class CreateBranchReqDto {
  @StringField({ maxLength: 150 })
  name!: string;

  /** Uppercase letters, digits, _ and -; unique within the store */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @StringField({ maxLength: 20 })
  @Matches(/^[A-Z0-9_-]{1,20}$/)
  code!: string;

  @StringFieldOptional({ maxLength: 255 })
  address?: string;

  @StringFieldOptional({ maxLength: 20 })
  @Matches(/^\+?[0-9]{8,15}$/)
  phone?: string;

  @BooleanFieldOptional()
  isWarehouse?: boolean;
}
```

`apps/platform/src/api/branch/dto/update-branch.req.dto.ts`:

```ts
import { EnumFieldOptional } from '@/decorators/field.decorators';
import { PartialType } from '@nestjs/swagger';
import { BranchStatus } from '../entities/branch.entity';
import { CreateBranchReqDto } from './create-branch.req.dto';

export class UpdateBranchReqDto extends PartialType(CreateBranchReqDto) {
  @EnumFieldOptional(() => BranchStatus)
  status?: BranchStatus;
}
```

`apps/platform/src/api/branch/dto/list-branch.req.dto.ts`:

```ts
import { PageOptionsDto } from '@/common/dto/offset-pagination/page-options.dto';
import { EnumFieldOptional } from '@/decorators/field.decorators';
import { BranchStatus } from '../entities/branch.entity';

export class ListBranchReqDto extends PageOptionsDto {
  @EnumFieldOptional(() => BranchStatus)
  readonly status?: BranchStatus;
}
```

`apps/platform/src/api/branch/dto/branch.res.dto.ts`:

```ts
import { BooleanField, ClassField, EnumField, StringField, StringFieldOptional } from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { BranchStatus } from '../entities/branch.entity';

@Exclude()
export class BranchResDto {
  @StringField() @Expose() id: string;
  @StringField() @Expose() name: string;
  @StringField() @Expose() code: string;
  @StringFieldOptional({ nullable: true }) @Expose() address: string | null;
  @StringFieldOptional({ nullable: true }) @Expose() phone: string | null;
  @BooleanField() @Expose() isWarehouse: boolean;
  @EnumField(() => BranchStatus) @Expose() status: BranchStatus;
  @ClassField(() => Date) @Expose() createdAt: Date;
}
```

- [ ] **Step 5: Service, controller and module**

`apps/platform/src/api/branch/branch.service.ts`:

```ts
import { OffsetPaginatedDto } from '@/common/dto/offset-pagination/paginated.dto';
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import { paginate } from '@/utils/offset-pagination';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { BranchResDto } from './dto/branch.res.dto';
import { CreateBranchReqDto } from './dto/create-branch.req.dto';
import { ListBranchReqDto } from './dto/list-branch.req.dto';
import { UpdateBranchReqDto } from './dto/update-branch.req.dto';
import { BranchEntity, BranchStatus } from './entities/branch.entity';

/** Every method takes the tenant from the token (ADR-0008); other tenants' rows are 404. */
@Injectable()
export class BranchService {
  constructor(
    @InjectRepository(BranchEntity)
    private readonly repository: Repository<BranchEntity>,
  ) {}

  async list(tenantId: string, query: ListBranchReqDto): Promise<OffsetPaginatedDto<BranchResDto>> {
    const builder = this.repository
      .createQueryBuilder('branch')
      .where('branch.tenantId = :tenantId', { tenantId })
      .orderBy('branch.createdAt', query.order);
    if (query.status) {
      builder.andWhere('branch.status = :status', { status: query.status });
    }
    const [branches, meta] = await paginate<BranchEntity>(builder, query, { skipCount: false, takeAll: false });
    return new OffsetPaginatedDto(plainToInstance(BranchResDto, branches), meta);
  }

  async get(tenantId: string, id: string): Promise<BranchResDto> {
    return (await this.find(tenantId, id)).toDto(BranchResDto);
  }

  async create(tenantId: string, accountId: string, dto: CreateBranchReqDto): Promise<BranchResDto> {
    await this.assertCodeFree(tenantId, dto.code);
    const branch = new BranchEntity({
      tenantId,
      name: dto.name,
      code: dto.code,
      address: dto.address ?? null,
      phone: dto.phone ?? null,
      isWarehouse: dto.isWarehouse ?? true,
      status: BranchStatus.ACTIVE,
      createdBy: accountId,
      updatedBy: accountId,
    });
    return (await this.save(branch)).toDto(BranchResDto);
  }

  async update(tenantId: string, accountId: string, id: string, dto: UpdateBranchReqDto): Promise<BranchResDto> {
    const branch = await this.find(tenantId, id);
    if (dto.code !== undefined && dto.code !== branch.code) {
      await this.assertCodeFree(tenantId, dto.code);
    }
    if (dto.status === BranchStatus.INACTIVE && branch.status === BranchStatus.ACTIVE) {
      await this.assertNotLastActive(tenantId);
    }
    Object.assign(
      branch,
      Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)),
    );
    branch.updatedBy = accountId;
    return (await this.save(branch)).toDto(BranchResDto);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const branch = await this.find(tenantId, id);
    if (branch.status === BranchStatus.ACTIVE) {
      await this.assertNotLastActive(tenantId);
    }
    await this.repository.softDelete({ id: branch.id, tenantId });
  }

  private async find(tenantId: string, id: string): Promise<BranchEntity> {
    const branch = await this.repository.findOne({ where: { id: id as BranchEntity['id'], tenantId } });
    if (!branch) {
      throw new NotFoundException();
    }
    return branch;
  }

  private async assertCodeFree(tenantId: string, code: string): Promise<void> {
    if (await this.repository.exists({ where: { tenantId, code } })) {
      throw new ValidationException(ErrorCode.B001);
    }
  }

  private async assertNotLastActive(tenantId: string): Promise<void> {
    if ((await this.repository.count({ where: { tenantId, status: BranchStatus.ACTIVE } })) <= 1) {
      throw new ValidationException(ErrorCode.B002);
    }
  }

  private async save(branch: BranchEntity): Promise<BranchEntity> {
    try {
      return await this.repository.save(branch);
    } catch (error) {
      if (isUniqueViolation(error, 'UQ_branch_tenant_code')) {
        throw new ValidationException(ErrorCode.B001);
      }
      throw error;
    }
  }
}
```

`apps/platform/src/api/branch/branch.controller.ts`:

```ts
import { OffsetPaginatedDto } from '@/common/dto/offset-pagination/paginated.dto';
import { ApiAuth } from '@/decorators/http.decorators';
import { Body, Controller, Delete, Get, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, CurrentUser, RequireRoles } from '@pbl/auth';
import { TenantRole } from '../tenant/entities/account-tenant.entity';
import { BranchService } from './branch.service';
import { BranchResDto } from './dto/branch.res.dto';
import { CreateBranchReqDto } from './dto/create-branch.req.dto';
import { ListBranchReqDto } from './dto/list-branch.req.dto';
import { UpdateBranchReqDto } from './dto/update-branch.req.dto';

@ApiTags('branches')
@Controller({ path: 'branches', version: '1' })
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @ApiAuth({ type: BranchResDto, summary: 'List branches of the selected store', isPaginated: true })
  @Get()
  list(@CurrentTenant() tenantId: string, @Query() query: ListBranchReqDto): Promise<OffsetPaginatedDto<BranchResDto>> {
    return this.branchService.list(tenantId, query);
  }

  @ApiAuth({ type: BranchResDto, summary: 'Create a branch (owner)', statusCode: HttpStatus.CREATED })
  @RequireRoles(TenantRole.OWNER)
  @Post()
  create(@CurrentTenant() tenantId: string, @CurrentUser('id') accountId: string, @Body() dto: CreateBranchReqDto): Promise<BranchResDto> {
    return this.branchService.create(tenantId, accountId, dto);
  }

  @ApiAuth({ type: BranchResDto, summary: 'Get a branch' })
  @ApiParam({ name: 'id', type: 'String' })
  @Get(':id')
  get(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<BranchResDto> {
    return this.branchService.get(tenantId, id);
  }

  @ApiAuth({ type: BranchResDto, summary: 'Update a branch (owner)' })
  @ApiParam({ name: 'id', type: 'String' })
  @RequireRoles(TenantRole.OWNER)
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchReqDto,
  ): Promise<BranchResDto> {
    return this.branchService.update(tenantId, accountId, id, dto);
  }

  @ApiAuth({ summary: 'Delete a branch (owner)', statusCode: HttpStatus.NO_CONTENT })
  @ApiParam({ name: 'id', type: 'String' })
  @RequireRoles(TenantRole.OWNER)
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.branchService.remove(tenantId, id);
  }
}
```

`apps/platform/src/api/branch/branch.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';
import { BranchEntity } from './entities/branch.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BranchEntity])],
  controllers: [BranchController],
  providers: [BranchService],
})
export class BranchModule {}
```

In `apps/platform/src/api/api.module.ts`, import `BranchModule` from `'./branch/branch.module'` and add it to `imports`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `IN_IMAGE "pnpm exec jest --config apps/platform/jest.config.json && pnpm exec tsc -p apps/platform/tsconfig.app.json --noEmit"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/platform/src
git commit -m "feat(platform): branches API scoped to the selected store" -m "List, create, read, update and soft-delete branches of the store in the token; other stores' branches answer 404. Codes are unique per store (B001). The last active branch cannot be deleted or deactivated (B002). Writes need the owner role."
```

---

### Task 7: Migration

**Files:**
- Create: `apps/platform/src/database/migrations/1791563000000-introduce-tenancy.ts`

**Interfaces:**
- Consumes: the table/constraint names in Global Constraints (must match the entities from Tasks 2–3).

- [ ] **Step 1: Write the migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P0 tenancy: user → account (name, phone, status), add tenant,
 * account_tenant and branch, and drop the post boilerplate. Existing
 * accounts keep working and simply have no store yet.
 */
export class IntroduceTenancy1791563000000 implements MigrationInterface {
  name = 'IntroduceTenancy1791563000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "post" DROP CONSTRAINT "FK_post_user_id"`);
    await queryRunner.query(`DROP TABLE "post"`);

    await queryRunner.query(`ALTER TABLE "user" RENAME TO "account"`);
    await queryRunner.query(`ALTER TABLE "account" RENAME CONSTRAINT "PK_user_id" TO "PK_account_id"`);
    await queryRunner.query(`DROP INDEX "UQ_user_username"`);
    await queryRunner.query(`ALTER INDEX "UQ_user_email" RENAME TO "UQ_account_email"`);
    await queryRunner.query(`ALTER TABLE "account" DROP COLUMN "username", DROP COLUMN "bio", DROP COLUMN "image"`);
    await queryRunner.query(`
      ALTER TABLE "account"
        ADD "name" character varying(100) NOT NULL DEFAULT '',
        ADD "phone" character varying(20),
        ADD "status" character varying(20) NOT NULL DEFAULT 'active'
    `);

    await queryRunner.query(`
      CREATE TABLE "tenant" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(150) NOT NULL,
        "subdomain" character varying(30) NOT NULL,
        "phone" character varying(20),
        "email" character varying(255),
        "address" character varying(255),
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL,
        CONSTRAINT "PK_tenant_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_tenant_subdomain" ON "tenant" ("subdomain") WHERE "deleted_at" IS NULL`);

    await queryRunner.query(`
      CREATE TABLE "account_tenant" (
        "account_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "role" character varying(32) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_tenant" PRIMARY KEY ("account_id", "tenant_id"),
        CONSTRAINT "FK_account_tenant_account" FOREIGN KEY ("account_id") REFERENCES "account"("id"),
        CONSTRAINT "FK_account_tenant_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "branch" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(150) NOT NULL,
        "code" character varying(20) NOT NULL,
        "address" character varying(255),
        "phone" character varying(20),
        "is_warehouse" boolean NOT NULL DEFAULT true,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL,
        CONSTRAINT "PK_branch_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_branch_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_branch_tenant_id" ON "branch" ("tenant_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_branch_tenant_code" ON "branch" ("tenant_id", "code") WHERE "deleted_at" IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "branch"`);
    await queryRunner.query(`DROP TABLE "account_tenant"`);
    await queryRunner.query(`DROP TABLE "tenant"`);

    await queryRunner.query(`ALTER TABLE "account" DROP COLUMN "name", DROP COLUMN "phone", DROP COLUMN "status"`);
    await queryRunner.query(`
      ALTER TABLE "account"
        ADD "username" character varying(50),
        ADD "bio" character varying NOT NULL DEFAULT '',
        ADD "image" character varying NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`ALTER INDEX "UQ_account_email" RENAME TO "UQ_user_email"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_user_username" ON "account" ("username") WHERE "deleted_at" IS NULL`);
    await queryRunner.query(`ALTER TABLE "account" RENAME CONSTRAINT "PK_account_id" TO "PK_user_id"`);
    await queryRunner.query(`ALTER TABLE "account" RENAME TO "user"`);

    await queryRunner.query(`
      CREATE TABLE "post" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying NOT NULL,
        "slug" character varying NOT NULL,
        "description" character varying,
        "content" character varying,
        "user_id" uuid NOT NULL,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL,
        CONSTRAINT "PK_post_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "post"
      ADD CONSTRAINT "FK_post_user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }
}
```

- [ ] **Step 2: Run up → down → up on a throwaway database, and compare with the entities**

```bash
docker compose up -d postgres
docker compose exec -T postgres psql -U postgres -qc "drop database if exists pbl_migtest" -c "create database pbl_migtest"
M="pnpm exec typeorm-ts-node-commonjs -d apps/platform/src/database/data-source.ts"
docker compose run --rm --no-deps -e DATABASE_NAME=pbl_migtest -e DATABASE_SCHEMA= -e DATABASE_SYNCHRONIZE=false \
  -v "$PWD:/work" -w /work platform sh -c "ln -sf /app/node_modules node_modules; \
  $M migration:run && $M migration:revert && $M migration:run && $M schema:log; rm -f node_modules"
docker compose exec -T postgres psql -U postgres -qc "drop database pbl_migtest"
```

Expected:
- every migration "executed successfully";
- the revert succeeds;
- `schema:log` prints **"Your schema is up to date - there are no queries to be executed by schema synchronization."**

If `schema:log` prints queries, the entities and the migration disagree: fix the entity or the migration until it is clean.

- [ ] **Step 3: Commit**

```bash
git add apps/platform/src/database/migrations/1791563000000-introduce-tenancy.ts
git commit -m "feat(platform): migration for accounts, tenants and branches" -m "Rename user to account (drop username/bio/image, add name/phone/status), create tenant, account_tenant and branch, and drop post. Reversible; verified up/down/up with schema:log clean against the entities."
```

---

### Task 8: Gateway routes and end-to-end checks

**Files:**
- Modify: `krakend/krakend.json`, `scripts/verify-local-stack.sh`

**Interfaces:**
- Consumes: all routes from Tasks 2, 4, 5 and 6.

- [ ] **Step 1: Update the gateway routes**

Run from the repo root:

```bash
python3 - <<'EOF'
import copy, json
path = 'krakend/krakend.json'
cfg = json.load(open(path, encoding='utf-8'))
eps = cfg['endpoints']
V1 = '/platform/api/v1'

# Template: an existing protected route (has auth/validator)
template = next(e for e in eps if e['endpoint'] == f'{V1}/auth/logout')
validator = template['extra_config']['auth/validator']
claims = validator['propagate_claims']
if ['tid', 'X-Tenant-Id'] not in claims:
    claims.append(['tid', 'X-Tenant-Id'])

# Drop the removed routes
eps[:] = [e for e in eps if not e['endpoint'].startswith((f'{V1}/users', f'{V1}/posts'))]

def protected(method, path):
    ep = copy.deepcopy(template)
    ep['endpoint'] = f'/platform{path}'
    ep['method'] = method
    ep['backend'][0]['url_pattern'] = path
    return ep

new_routes = [
    ('POST', '/api/v1/auth/switch-tenant'),
    ('GET', '/api/v1/accounts/me'), ('PATCH', '/api/v1/accounts/me'),
    ('GET', '/api/v1/tenants'), ('POST', '/api/v1/tenants'),
    ('GET', '/api/v1/tenants/current'), ('PATCH', '/api/v1/tenants/current'),
    ('GET', '/api/v1/branches'), ('POST', '/api/v1/branches'),
    ('GET', '/api/v1/branches/{id}'), ('PATCH', '/api/v1/branches/{id}'), ('DELETE', '/api/v1/branches/{id}'),
]
existing = {(e['method'], e['endpoint']) for e in eps}
insert_at = eps.index(next(e for e in eps if e['endpoint'] == f'{V1}/auth/logout')) + 1
for method, path in reversed(new_routes):
    if (method, f'/platform{path}') not in existing:
        eps.insert(insert_at, protected(method, path))

# Every protected route forwards X-Tenant-Id (informational)
for e in eps:
    if 'auth/validator' in e.get('extra_config', {}):
        e['extra_config']['auth/validator'] = validator
        if 'X-Tenant-Id' not in e['input_headers']:
            e['input_headers'].append('X-Tenant-Id')

json.dump(cfg, open(path, 'w', encoding='utf-8', newline='\n'), indent=2)
open(path, 'a', encoding='utf-8', newline='\n').write('\n')
print(len(eps), 'endpoints')
EOF
docker run --rm -v "$PWD/krakend:/etc/krakend" devopsfaith/krakend:2.6 check -t -c /etc/krakend/krakend.json
```

Expected: "Syntax OK!". `grep -c '"/platform/api/v1/users' krakend/krakend.json` prints `0`.

- [ ] **Step 2: Extend the verify script**

In `scripts/verify-local-stack.sh`, replace everything from the line `token=$(curl -s -H "Content-Type: application/json" -d "$creds" "$api/auth/email/login" \` to the end of the file with:

```bash
json_field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"; }
login_token() { curl -s -H "Content-Type: application/json" -d "$1" "$api/auth/email/login" | json_field accessToken; }
expect_code() { # expected method url token [body]
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -X "$2" -H "Authorization: Bearer $4" \
    -H "Content-Type: application/json" ${5:+-d "$5"} "$3")
  [[ "$code" == "$1" ]] || fail "$2 $3 returned $code (expected $1)"
  echo "OK: $2 ${3#"$gateway"} -> $1"
}

token=$(login_token "$creds")
[[ -n "$token" ]] || fail "login response had no accessToken"
expect_code 200 GET "$api/accounts/me" "$token"
expect_code 401 GET "$api/accounts/me" "not-a-token"
expect_code 403 GET "$api/branches" "$token"   # no store selected yet

echo "Creating a store through the gateway..."
sub="verify-$(date +%s)"
created=$(curl -s -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
  -d "{\"name\":\"Verify\",\"subdomain\":\"$sub\"}" "$api/tenants")
store_token=$(echo "$created" | json_field accessToken)
[[ -n "$store_token" ]] || fail "POST /tenants returned no token: $created"
echo "OK: POST /platform/api/v1/tenants -> store with token"
expect_code 401 GET "$api/accounts/me" "$token"   # the pre-store session was ended
branch=$(curl -s -H "Authorization: Bearer $store_token" -H "Content-Type: application/json" \
  -d '{"name":"Kho 2","code":"KHO2"}' "$api/branches")
branch_id=$(echo "$branch" | sed -n 's/^{"id":"\([^"]*\)".*/\1/p')
[[ -n "$branch_id" ]] || fail "POST /branches returned no id: $branch"
echo "OK: POST /platform/api/v1/branches -> $branch_id"
expect_code 200 GET "$api/branches" "$store_token"
expect_code 200 GET "$api/branches/$branch_id" "$store_token"

echo "Checking that another store cannot see it..."
other="{\"email\":\"verify-other-$(date +%s)@example.com\",\"password\":\"Passw0rd!\"}"
curl -s -o /dev/null -H "Content-Type: application/json" -d "$other" "$api/auth/email/register"
other_token=$(curl -s -H "Authorization: Bearer $(login_token "$other")" -H "Content-Type: application/json" \
  -d "{\"name\":\"Other\",\"subdomain\":\"$sub-b\"}" "$api/tenants" | json_field accessToken)
[[ -n "$other_token" ]] || fail "second store was not created"
expect_code 404 GET "$api/branches/$branch_id" "$other_token"

echo "Stack verified."
```

- [ ] **Step 3: Run the stack end to end**

```bash
docker compose down -v     # the old local volume predates the migration
bash scripts/verify-local-stack.sh
```

Expected: every line `OK: …`, ending with `Stack verified.`

- [ ] **Step 4: Commit**

```bash
git add krakend/krakend.json scripts/verify-local-stack.sh
git commit -m "feat(gateway): route accounts, tenants and branches; propagate tid" -m "Declare the new platform routes behind auth/validator, drop /users and /posts, and forward the tid claim as X-Tenant-Id. verify-local-stack.sh now checks /accounts/me, store creation, that the pre-store session ends, branch CRUD, and that another store gets 404."
```

---

### Task 9: Documentation

**Files:**
- Modify: `CLAUDE.md`, `docs/decisions/0004-authentication-and-tokens.md`, `docs/decisions/0008-tenancy.md`, `docs/deploy-actions.md`, `docs/specs/2026-10-10-p0-platform-tenancy-design.md`, `README.md`

- [ ] **Step 1: Update the docs**

- **`CLAUDE.md`, "Current state vs target" table:**
  - *Data* row: Today becomes "One Postgres DB `pbl`, one schema per service; platform has `account`, `tenant`, `account_tenant`, `branch`, `refresh_token`".
  - *Tenancy* row: Today becomes "Implemented (P0): stores, branches, `tid` + `roles` in tokens, `@CurrentTenant()`/`@RequireRoles()`"; Target becomes "Staff logins, RBAC `perms`, plans/subscriptions".
  - *Auth* row: Today adds "tokens carry `tid`/`roles`".
- **`CLAUDE.md`, "Auth rules":** add the bullet "`PblAuthModule` tenant mode: other services are `required` (a token without `tid` gets 403 unless `@TenantOptional()`); platform is `optional` and uses `@CurrentTenant()` on store routes."
- **`CLAUDE.md`, "Known open work":** delete the bullet about `/users/:id` having no ownership check (the routes are gone).
- **ADR-0004, "Implementation status" table:** step 5 row becomes "Partly done: `tid` and `roles` (P0); `perms` + `@RequirePermission` wait for Staff/RBAC".
- **ADR-0008, Status:** "Accepted and implemented (P0, 2026-10-10)".
- **`docs/deploy-actions.md`:** under section 3, add the bullet "The P0 migration `1791563000000-introduce-tenancy` renames `user` to `account` and **drops `post`**. Take a database backup first; existing accounts keep working and have no store until they create one."
- **P0 spec, Status:** "Implemented".
- **README, Quick start "Try it" block:** after the register example, add:

```bash
# log in, create a store (the response carries a token bound to it)
TOKEN=$(curl -s -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"Passw0rd!"}' \
  http://localhost:8080/platform/api/v1/auth/email/login | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"My Shop","subdomain":"my-shop"}' http://localhost:8080/platform/api/v1/tenants
```

- [ ] **Step 2: Check links and run the whole suite once more**

Run:
```bash
IN_IMAGE "pnpm exec jest --config apps/platform/jest.config.json && pnpm exec jest libs apps/catalog/src apps/commerce/src apps/finance/src apps/integration/src apps/insight/src && pnpm lint:check"
bash scripts/verify-local-stack.sh
```
Expected: all tests pass, lint is clean, and the script ends with "Stack verified."

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md docs
git commit -m "docs: record P0 tenancy as implemented" -m "Update the current-state table, auth rules and open work in CLAUDE.md; ADR-0004 step 5 is partly done and ADR-0008 implemented; deploy-actions warns that the migration renames user and drops post; README shows creating a store."
```
