# OpenAPI guide

The API reference is **generated from the controllers**, never written by hand. One command builds a document per
service and one merged document that looks like the gateway.

## Regenerate

```bash
pnpm openapi                       # writes docs/openapi/*.json: commit them
pnpm openapi --out some/folder     # somewhere else
```

It is `ts-node -r tsconfig-paths/register --transpile-only scripts/generate-openapi.ts`. Nothing connects to a
database, queue or Redis: each app is created with `NestFactory.create(AppModule, { preview: true })`, which builds the
route table without instantiating a provider, and the config validation gets dummy values
(`scripts/openapi/create-documents.ts`). It takes about ten seconds.

| File                          | Content                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/openapi/<service>.json` | One service's own routes, as its `/api-docs` shows them (`platform`, `catalog`, `inventory`, `sales`, `finance`, `integration`, `insight`, `customer`). Includes the `/internal/...` and health routes. |
| `docs/openapi/openapi.json`   | ONE document for the gateway: what a client can call.                                                                                                                                                   |

The same documents are served live by each service at `/api-docs` when `APP_SWAGGER_ENABLED` is not `false`
(production: only platform, behind basic auth; the gateway does not route `/api-docs`).

**Published copy.** `docs/openapi/*.json` is committed, and GitHub Pages serves the `docs` folder, so
`https://sapoclone.github.io/pbl-api/swagger/` shows the merged document in Swagger UI (read-only: the gateway does not
allow that origin, so no Try it out) and `.../openapi/<service>.json` are the raw files. The `libs` job of CI runs
`pnpm openapi` and fails on a diff, so a controller or krakend change needs the regenerated files in the same PR.

## How the merged document maps to the gateway

- **Paths** are `/<service>` + the service path, exactly the entries of `krakend/krakend.json`
  (`/sales/api/v1/orders`). Routes the gateway does not expose stay out: `/internal/...`, the health probes, and the
  `v1/...` twins of `api/v1/...` that some controllers register for service-to-service calls.
- **Tags** are prefixed with the service (`sales / orders`); the platform-admin groups come first.
- **Security** is a single `bearerAuth` scheme (the services call it `bearer`; it is renamed on merge).
- **Schemas** keep their names; a name two services define differently gets the service as prefix
  (`FinanceTriggerReconciliationRunDto`).
- **Servers** is the gateway (`http://localhost:8080`).

## Add a route

1. Add the handler and its krakend entry (`krakend/krakend.json`, then `krakend check`).
2. Write what the document needs:
   - `@ApiTags('<group>')` on the controller;
   - `@ApiOperation({ summary: '...' })` on the handler: short, one line, what it does for the caller. Say the
     permission in the description (`Needs reports.view`);
   - `@ApiBearerAuth()` on the controller of every protected route (everything but `@Public()`). Platform's
     `ApiAuth()` / `ApiPublic()` decorators set both;
   - DTO fields: plain class-validator decorators are enough. The Nest Swagger plugin (`nest-cli.json`) reads the
     class, the TypeScript types, the validators and the `/** comments */` and emits the schema, so do not add
     `@ApiProperty` unless you need an `example` or a type the plugin cannot see. The plugin only reads files
     ending in `.dto.ts`, `.req.dto.ts`, `.res.dto.ts` or `.res.ts`; a DTO declared in a controller file gets no
     schema.
   - Response bodies: return a DTO class (`Promise<OrderResDto>`), or add
     `@ApiOkResponse({ type: OrderResDto })`. A handler that returns an interface or `any` documents no response body.
3. Run `pnpm openapi` and look at the entry, or `pnpm test:arch`.

## The drift test

`scripts/openapi/openapi-drift.spec.ts` (part of `pnpm test:arch`, no database) runs the generator and fails, naming the
route, when:

- a client-facing route of `krakend.json` (health and internal excluded; `{param}` names do not matter) is not served by
  a controller, or a merged route is not in krakend;
- a controller serves a route krakend does not expose and it is neither internal nor an `/api` alias. The one known
  case is listed with its reason in `KNOWN_UNEXPOSED`; the test fails when an entry stops being true;
- an operation has no summary or no tag;
- an operation protected by the auth guard (not `@Public()`, not `@AuthOptional()`) does not list `bearerAuth`, or a
  `@Public()` one does.

## Generate a typed client

```bash
npx openapi-typescript docs/openapi/openapi.json -o src/api/schema.d.ts
```

Then use the `paths` type with a fetch wrapper such as `openapi-fetch`; it is not a dependency of this repository.
