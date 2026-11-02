import { withoutTestSwitches } from './test-switches';

describe('withoutTestSwitches', () => {
  it('drops simulate… fields outside tests and keeps the rest', () => {
    const dto = { reason: 'r', simulateProviderTimeout: true };
    expect(withoutTestSwitches(dto, { NODE_ENV: 'production' })).toEqual({
      reason: 'r',
    });
  });

  it('keeps them under NODE_ENV=test', () => {
    const dto = { simulateProviderTimeout: true };
    expect(withoutTestSwitches(dto, { NODE_ENV: 'test' })).toEqual(dto);
  });
});
