# ADR-0005: Side effects such as email go through SQS to separate workers

- **Status:** Accepted
- **Date:** recorded 2026-10-08 (in place since the pbl-mail-service Lambda rewrite)
- **Scope:** `apps/platform/src/queue`, sibling repo `pbl-mail-service`, pbl-infra `sqs.tf`/`lambda.tf`

## Context

Sending email inline makes requests slow and fragile (provider outages
fail the user's request). pbl-mail-service owns templates and the Resend
integration and runs as a container-image Lambda triggered by SQS, so
there is no HTTP endpoint or shared secret between the API and the mailer
— IAM is the trust boundary (pbl-infra README).

## Decision

- Services never call an email (or other third-party side-effect)
  provider directly. They publish a message via `QueueService`
  (`@aws-sdk/client-sqs`) to the relevant queue, e.g.
  `email-verification` with body `{ email, token }`.
- Message contracts are owned jointly with the consumer: a change to the
  body shape must be made in pbl-mail-service
  (`SendVerificationEmailDto`) in a compatible way first.
- Consumers report per-message failures (`batchItemFailures`); after 3
  attempts messages go to the DLQ (`email-verification-dlq`).
- Locally, ElasticMQ (`docker/elasticmq.conf`) emulates SQS. The SDK is
  redirected with `AWS_ENDPOINT_URL_SQS` and dummy keys in
  `.env.docker.platform`; application code stays unaware of it.
- The future domain event bus (SNS/SQS, outbox/inbox, ~20 events) follows
  the same principle, but its design is **not decided yet** — write an ADR
  before building it.

## Consequences

- Delivery is at-least-once: consumers must be idempotent.
- Today `register` saves the user and then enqueues without an outbox: if
  the enqueue fails, the request returns 500 but the user exists with no
  email sent. Fixing this (transactional outbox, or a working resend
  endpoint) is open work.
- No DLQ alerting yet (pbl-infra README "things to revisit").

## Alternatives considered

- **Inline sending from the API:** simplest, but couples request latency
  and success to the provider.
- **HTTP call to a mail service (QStash/signature-based):** used before;
  replaced because SQS + IAM removes the shared secret and gives retries
  and a DLQ for free.
