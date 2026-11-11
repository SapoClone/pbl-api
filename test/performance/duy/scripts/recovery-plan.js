// Shared by the real prepared workload and the no-network scheduler test.
export function recoveryScenarios(loadScale = 1, recoverySeconds = 30) {
  const seconds = n => `${n * loadScale}s`;
  return {
    spike_load: {
      executor: 'ramping-vus', startVUs: 0,
      stages: [{ duration: seconds(10), target: 50 }, { duration: seconds(30), target: 50 }, { duration: seconds(10), target: 0 }],
      gracefulRampDown: seconds(5), gracefulStop: seconds(5), exec: 'readStockLevels',
    },
    spike_recovery: {
      executor: 'constant-vus', vus: 1, startTime: seconds(55),
      duration: `${recoverySeconds}s`, gracefulStop: '5s', exec: 'readStockLevels',
    },
  };
}

export function recoveryStage(name, progress) {
  if (name === 'spike_recovery') return 'recovery_1_vu';
  const elapsed = progress * 50;
  return elapsed < 10 ? 'ramp_up' : elapsed < 40 ? 'hold_50_vu' : 'ramp_down';
}
