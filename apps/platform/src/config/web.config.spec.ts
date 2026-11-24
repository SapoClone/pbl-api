import webConfig, { DEFAULT_WEB_APP_URL } from './web.config';

describe('WebConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.spyOn(console, 'info').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults to the local Vite dev server', async () => {
    delete process.env.WEB_APP_URL;
    expect((await webConfig()).appUrl).toBe(DEFAULT_WEB_APP_URL);
    expect(DEFAULT_WEB_APP_URL).toBe('http://localhost:5173');
  });

  it('uses WEB_APP_URL without a trailing slash', async () => {
    process.env.WEB_APP_URL = 'https://app.example.com/';
    expect((await webConfig()).appUrl).toBe('https://app.example.com');
  });

  it('rejects a value that is not a URL', async () => {
    process.env.WEB_APP_URL = 'not a url';
    await expect(async () => await webConfig()).rejects.toThrow(Error);
  });
});
