import { clientIp, describeDevice } from './client-info.decorator';

describe('describeDevice', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Chrome · Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120',
      'Edge · Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1',
      'Safari · iOS',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14) Gecko/20100101 Firefox/121',
      'Firefox · macOS',
    ],
    ['okhttp/4.12', 'okhttp/4.12'],
  ])('%s -> %s', (userAgent, label) => {
    expect(describeDevice(userAgent)).toBe(label);
  });

  it('is null without a user agent', () => {
    expect(describeDevice(null)).toBeNull();
  });
});

describe('clientIp', () => {
  it('takes the first hop of X-Forwarded-For (the real client behind the gateway)', () => {
    expect(
      clientIp({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' }, '172.18.0.9'),
    ).toBe('203.0.113.7');
  });

  it('reads a repeated header and trims spaces', () => {
    expect(
      clientIp(
        { 'x-forwarded-for': ['  203.0.113.7 ', '10.0.0.2'] },
        undefined,
      ),
    ).toBe('203.0.113.7');
  });

  it('falls back to the socket address, then to null', () => {
    expect(clientIp({}, '172.18.0.9')).toBe('172.18.0.9');
    expect(clientIp(undefined, undefined)).toBeNull();
    expect(clientIp({ 'x-forwarded-for': '' }, '172.18.0.9')).toBe(
      '172.18.0.9',
    );
  });

  it('keeps the value within the column size', () => {
    expect(
      clientIp({ 'x-forwarded-for': 'a'.repeat(80) }, undefined),
    ).toHaveLength(45);
  });
});
