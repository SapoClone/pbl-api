import { CacheKey } from '@/constants/cache.constant';
import { sessionDenyListKey } from '@pbl/auth';
import { createCacheKey } from './cache.util';

describe('createCacheKey', () => {
  it('should write the logout deny-list key services read via @pbl/auth', () => {
    expect(createCacheKey(CacheKey.SESSION_BLACKLIST, 'x')).toBe(
      sessionDenyListKey('x'),
    );
  });
});
