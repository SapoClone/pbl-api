import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
const admitted = new Counter('synthetic_admitted');
const skipped = new Counter('synthetic_boundary_skipped');
export const options = { scenarios: { concurrency: { executor: 'per-vu-iterations', vus: 5, iterations: 6, maxDuration: '10s' } } };
export default function () {
  const id = exec.scenario.iterationInTest;
  if (id >= 25) { skipped.add(1); return; }
  admitted.add(1, { request_id: `synthetic-${id}`, vu: String(exec.vu.idInTest) });
}
