/**
 * Prints the event topology as JSON for pbl-infra (`terraform/events-topology.json`):
 * one SNS topic per producing service, one queue (+ DLQ) per consuming service, and
 * for each queue the event types it takes from each producer (the SNS filter policy).
 * Terraform reads the file, so topics and subscriptions cannot drift from
 * `libs/contracts/src/topology.ts`.
 *
 *   pnpm exec ts-node -r tsconfig-paths/register --transpile-only scripts/export-topology.ts > topology.json
 */
import { TOPOLOGY, producerOf } from '../libs/contracts/src/topology';

const queues: Record<string, Record<string, string[]>> = {};
for (const [service, types] of Object.entries(TOPOLOGY.subscriptions)) {
  const byProducer: Record<string, string[]> = {};
  for (const type of types as readonly string[]) {
    const producer = producerOf(type);
    if (!producer)
      throw new Error(
        `${service} subscribes to ${type}, which no service produces`,
      );
    (byProducer[producer] ??= []).push(type);
  }
  queues[service] = byProducer;
}

const out = {
  topics: Object.keys(TOPOLOGY.producers).sort(),
  queues,
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
