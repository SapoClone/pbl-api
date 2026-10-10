# API conventions

Rules for every HTTP API in this repo (all six services). Follow them for
new endpoints; change existing endpoints toward them when you touch them.

Items marked **(new)** were decided on 2026-10-10 for the
[catalog & commerce roadmap](../specs/2026-10-10-catalog-commerce-roadmap.md)
and have no implementation yet. Everything else describes how the API
behaves today. The examples are real responses from the local stack.

Related: [ADR-0003 gateway](../decisions/0003-krakend-api-gateway.md),
[ADR-0004 auth](../decisions/0004-authentication-and-tokens.md),
[ADR-0008 tenancy](../decisions/0008-tenancy.md), [`CLAUDE.md`](../../CLAUDE.md).

## 1. URLs

- **Clients call the gateway only:**
  `http://<gateway>/<service>/api/v1/<resource>`. The gateway path is the
  service name plus the service's own path (`/api/v1/...`).
- **Version** in the URI (`v1`). A breaking change gets `v2` for the
  affected controller; `v1` keeps working until clients have moved.
- **Resources are plural, kebab-case nouns:** `/branches`, `/products`,
  `/stock-takes`, `/sales-channels`.
- **Ids** are UUID v4 strings in the path (`/branches/{id}`), validated with
  `ParseUUIDPipe`. A malformed id → 400.
- **Nest a resource only when it cannot exist without its parent:**
  `/orders/{id}/payments`, `/products/{id}/variants`. One level deep at most.
- **Aliases for "mine":** `/accounts/me`, `/tenants/current`.
- **Actions that are not CRUD** are `POST` on a verb sub-path:
  `/orders/{id}/cancel`, `/shifts/{id}/close`, `/auth/switch-tenant`.
- **Every route** must be declared in `krakend/krakend.json` (see
  [ADR-0003](../decisions/0003-krakend-api-gateway.md)). Undeclared routes 404
  at the gateway.

## 2. Methods and status codes

| Method | Use | Success |
|---|---|---|
| `GET` | read one / list | **200** |
| `POST` (create) | create a resource | **201** + the created resource **(new; existing creates still return 200)** |
| `POST` (action) | login, switch tenant, cancel, … | **200** + result |
| `PATCH` | partial update | **200** + the updated resource |
| `DELETE` | delete (soft delete for business data) | **204**, no body **(new; existing deletes return 200)** |

There is no `PUT`. Set the code with `@ApiAuth({ statusCode: HttpStatus.CREATED })`
(or `NO_CONTENT`), so that Swagger and the response agree.

## 3. JSON bodies

- **Field names:** camelCase in requests and responses (`createdAt`,
  `branchId`). Database columns stay snake_case.
- **Ids:** strings (UUID).
- **Timestamps:** ISO 8601 in UTC with milliseconds:
  `"2026-10-10T15:00:31.320Z"`. Names end in `At` (`createdAt`, `paidAt`).
- **Dates without time (new):** `"YYYY-MM-DD"` (e.g. `dob`,
  `promotion.startDate`).
- **Money (new):** integer VND as a JSON number (`"totalAmount": 259000`),
  `bigint` in the database. No floats, no currency field.
- **Quantities (new):** integers in the product's base unit. A line's unit
  and conversion factor are separate fields, as in the ERD.
- **Enums (new):** lowercase snake_case strings: `"pending"`, `"tiktok_shop"`,
  `"out_of_stock"`. Each enum is listed in Swagger (`EnumField`).
- **Booleans:** `isX` / `hasX` (`isWarehouse`, `hasShortage`).
- **Absent vs null (new):** response DTOs always include their documented
  fields. A missing value is `null`, not an omitted key. The exception is
  `nextPage` / `previousPage` in pagination, which are omitted when they
  don't apply.
- **Response DTOs** are `@Exclude()` + `@Expose()` per field. Never return
  an entity. Request DTOs use the field decorators in
  `decorators/field.decorators.ts`. Unknown request fields are stripped
  (`whitelist: true`).

## 4. Response shapes

**A single resource is returned as a plain object, with no envelope.**

**Offset-paginated lists** (default for lists):

```json
{
  "data": [ { "id": "ac15f97d-…", "email": "…", "createdAt": "2026-10-10T15:00:31.320Z" } ],
  "pagination": {
    "limit": 2,
    "currentPage": 1,
    "nextPage": 2,
    "totalRecords": 18,
    "totalPages": 9
  }
}
```

**Cursor-paginated lists** (feeds, infinite scroll):
`{ "data": [...], "pagination": { "limit", "afterCursor", "beforeCursor", "totalRecords" } }`.

## 5. List queries

| Param | Meaning |
|---|---|
| `page` | 1-based page number (default 1) |
| `limit` | page size, default **10**, maximum **100** (more → 422) |
| `q` | free-text search; each endpoint documents which fields it searches |
| `order` | `ASC` / `DESC` on the endpoint's default sort key (usually `createdAt`) |
| `sort` **(new)** | sort field, from a whitelist the endpoint documents; anything else → 422 |
| filters | plain camelCase params: `status=active`, `branchId=<uuid>` |
| multi-value **(new)** | comma-separated: `channel=pos,shopee` |
| date range **(new)** | `from` / `to`, `YYYY-MM-DD`, both inclusive, in the store's timezone (`Asia/Ho_Chi_Minh` until tenants have a timezone) |

The client computes presets such as "last 7 days" and sends `from`/`to`.
The tenant always comes from the token, never from a query param (§8).

## 6. Errors

Every service error uses one shape (`GlobalExceptionFilter`). Real examples:

**422 — request validation** (`details` per field):
```json
{
  "timestamp": "2026-10-10T15:00:31.004Z",
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "message": "Validation failed",
  "details": [
    { "property": "email", "code": "isEmail", "message": "email must be an email" },
    { "property": "password", "code": "minLength", "message": "password must be longer than or equal to 6 characters" }
  ]
}
```

**400 — business rule** (with `errorCode`, message localised; here `x-lang: vi`):
```json
{ "timestamp": "…", "statusCode": 400, "error": "Bad Request", "errorCode": "E003", "message": "Tài khoản với email này đã tồn tại" }
```

| Status | When | Client action |
|---|---|---|
| 400 | Business rule broken (`errorCode`); malformed path param | Show `message`; branch on `errorCode` |
| 401 | Missing, invalid or expired token | Refresh once, retry; on a second 401 go to login |
| 403 | Token has no tenant, or lacks the role | Store picker / "not allowed" |
| 404 | Not found **or belongs to another tenant** (never 403, to avoid leaking existence) | "Not found" |
| 409 **(new)** | Optimistic-lock conflict (`version` mismatch, §9) or duplicate `Idempotency-Key` still processing | Reload, retry |
| 422 | Request validation (`details`) | Highlight fields |
| 500 | Bug | Generic error; it is logged |

Rules:

- **`errorCode`** is a stable identifier clients may branch on. It is unique
  within a service and listed in that service's `ErrorCode` enum: a domain
  letter plus 3 digits (`E003`, `T001`, `B001`). Its message lives in
  `i18n/en`, `vi` **and** `jp`.
- **Validation `details` messages are English only.** Clients should map
  `code` (class-validator rule) to their own text, not show the raw message.
- **401 from the gateway has an empty body.** KrakenD rejects bad tokens
  before the service sees them. Clients must decide on the **status code**,
  never on the body.
- **Stack traces** (`stack`, `trace`) appear only with `APP_DEBUG=true`
  (local). Never rely on them.

## 7. Headers

| Header | Direction | Meaning |
|---|---|---|
| `Authorization: Bearer <accessToken>` | request | every protected route |
| `Content-Type: application/json` | request | bodies are JSON only |
| `x-lang` / `Accept-Language` (or `?lang=`) | request | `en` (default), `vi`, `jp`: localises error messages |
| `Idempotency-Key: <uuid>` **(new, P5)** | request | **required** on order creation and payments; the same key returns the first result instead of creating twice (mobile retries on bad networks) |

Every new request header must be added in three places: the gateway's
`input_headers`, `security/cors.allow_headers`, and the service's
`enableCors`.

## 8. Auth and tenancy

- **Protected by default.** Public routes are explicit (`@ApiPublic` /
  `@Public`); see [ADR-0004](../decisions/0004-authentication-and-tokens.md).
- **The tenant comes only from the token's `tid`** (`@CurrentTenant()`),
  never from body, query, path or headers
  ([ADR-0008](../decisions/0008-tenancy.md)). Branch ids in requests are
  checked to belong to that tenant.
- **Role checks** use `@RequireRoles(...)` → 403.

## 9. Concurrency (new, P5)

Resources edited from several devices (orders, stock takes, shifts) expose
`version` (integer). `PATCH` and actions on them must send the `version`
they read. A mismatch → 409, and the client reloads.

## 10. Documentation

- **Swagger:** every endpoint has `@ApiAuth(...)` / `@ApiPublic(...)` with
  `type` and `summary`; list endpoints add `isPaginated: true`. Platform
  serves Swagger at `/api-docs`. New services must set it up the same way
  before their first endpoint ships.
- **Route list for clients:** a sub-project's spec lists its endpoints, so
  mobile/web know what became available.

## Checklist for a new endpoint

1. Path, method and status code follow §1–§2; resource name is plural kebab-case.
2. Request DTO uses field decorators; response DTO uses `@Exclude`/`@Expose`.
   JSON follows §3: camelCase, ISO UTC timestamps, integer VND, snake_case enums.
3. Lists use `PageOptionsDto` and return `{ data, pagination }`.
4. Tenant from `@CurrentTenant()`; every query filters by it; cross-tenant
   test → 404.
5. Business errors get an `errorCode` + en/vi/jp messages.
6. Route added to `krakend/krakend.json`, with `auth/validator` when
   protected. New headers added in the three places.
7. Swagger decorators complete; the unit tests and `scripts/verify-local-stack.sh` pass.
