# ADR-002: Pragmatic Hexagonal Layering & 100% Pure Domain Modules

- **Status:** Accepted (Enforced in M7.5)
- **Date:** 2026-10-31

## Context
When business rules (e.g., weighted-average cost math, 3D order state machines, proportional discount waterfalls, journal balancing, webhook signature verification) are mixed into NestJS `@Injectable()` services or TypeORM entities, unit tests require heavy mocking and framework upgrades risk breaking core domain logic. Furthermore, reading `process.env` directly inside a domain module (found in `integration-domain.ts:216` during M7.5 audit) couples domain logic to runtime process state.

## Decision
1. Every microservice must have a pure TypeScript domain layer at `apps/<service>/src/domain/<service>-domain.ts`.
2. Files in `src/domain/**` are strictly forbidden from importing `@nestjs/*`, `typeorm`, `axios`, `ioredis`, `@aws-sdk/*`, `express`, or referencing `process.env` (`Rule B`).
3. Files in `src/domain/**` may never import from application (`modules/`, `api/`), infrastructure (`infrastructure/`), or presentation (`controllers/`, `consumers/`) layers (`Rule C & D`).

## Consequences
- **Positive:** Core retail invariants execute in $< 50\text{ ms}$ in pure unit tests with zero mocks and 100% deterministic behavior.
- **Negative / Trade-off:** Application services must map database rows/DTOs into domain Value Objects and Aggregate inputs before invoking domain logic.
