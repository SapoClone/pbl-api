import exec from 'k6/execution';
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { recoveryScenarios, recoveryStage } from './recovery-plan.js';

// No HTTP import or API calls. Compress only the load/grace timeline;
// recovery retains one VU for a real 30-second window.
export const options = { scenarios: recoveryScenarios(0.02, 30) };
const attempts = new Counter('synthetic_request_attempts');
export function readStockLevels() {
  attempts.add(1, { stage: recoveryStage(exec.scenario.name, exec.scenario.progress), vu: String(exec.vu.idInTest) });
  sleep(1);
}
