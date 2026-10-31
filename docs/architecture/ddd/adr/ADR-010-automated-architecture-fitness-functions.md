# ADR-010: Automated Architecture Fitness Functions in CI (`pnpm test:arch`)

- **Status:** Accepted (Implemented in M7.5)
- **Date:** 2026-10-31

## Context
Without automated guardrails, microservice repositories gradually accumulate cross-app imports, `process.env` or ORM leaks inside `src/domain`, cross-schema SQL queries, or missing Row-Level Security policies on new tables.

## Decision
1. Maintain `libs/common/src/bootstrap/ddd-architecture-fitness.spec.ts` alongside per-service `<service>-architecture.spec.ts` files.
2. Enforce Rules A through J automatically via `pnpm test:arch`:
   - Rule A: Service isolation
   - Rule B: Domain purity
   - Rule C & D: Hexagonal inward dependency direction
   - Rule E: Database schema ownership
   - Rule F: Shared package discipline
   - Rule G: Acyclic domain dependency graph
   - Rule H: Integration contract & topology stability
   - Rule I: Multi-tenant PostgreSQL RLS enforcement
   - Rule J: Tactical DDD invariants & aggregates across all 8 bounded contexts

## Consequences
- **Positive:** Architectural violations fail fast in $< 6\text{ seconds}$ during local development and CI before code review.
- **Negative / Trade-off:** New bounded contexts or domain modules must register their core invariant symbols in the fitness suite.
