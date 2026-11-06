import { Logger } from '@nestjs/common';
import { warnIfRevocationMissing } from './pbl-auth.module';
import { RedisSessionRevocation } from './redis-session-revocation';

describe('warnIfRevocationMissing', () => {
  let error: jest.SpyInstance;
  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => error.mockRestore());

  it.each(['production', 'staging'])(
    'logs an ERROR in %s when REDIS_HOST is missing',
    (env) => {
      expect(warnIfRevocationMissing(null, env)).toBe(true);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('REDIS_HOST'));
    },
  );

  it.each(['local', 'development', 'test', undefined])(
    'stays quiet in %s',
    (env) => {
      expect(warnIfRevocationMissing(null, env)).toBe(false);
      expect(error).not.toHaveBeenCalled();
    },
  );

  it('stays quiet when the deny-list is wired', () => {
    expect(
      warnIfRevocationMissing({} as RedisSessionRevocation, 'production'),
    ).toBe(false);
  });
});
