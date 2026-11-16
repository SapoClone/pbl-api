import {
  decryptCredentialSecret,
  encryptCredentialSecret,
} from '../domain/integration-domain';
import {
  assertIntegrationConfig,
  readLazadaConfig,
} from './integration.config';

describe('integration config (fail closed)', () => {
  const full = {
    INTEGRATION_CREDENTIAL_MASTER_KEY: 'k'.repeat(32),
    SALES_SERVICE_URL: 'http://sales:3000',
    INTERNAL_S2S_TOKEN: 's3cret',
  };

  it('accepts a complete environment', () => {
    expect(() => assertIntegrationConfig(full)).not.toThrow();
  });

  it.each(Object.keys(full))('refuses to start without %s', (name) => {
    const env: Record<string, string | undefined> = { ...full };
    delete env[name];
    expect(() => assertIntegrationConfig(env)).toThrow(name);
  });

  it('never puts a value in the message', () => {
    expect(() =>
      assertIntegrationConfig({ ...full, INTERNAL_S2S_TOKEN: '' }),
    ).toThrow(/INTERNAL_S2S_TOKEN is not set/);
  });

  it('refuses to start when INTEGRATION_CREDENTIAL_MASTER_KEY is shorter than 16 characters', () => {
    expect(() =>
      assertIntegrationConfig({
        ...full,
        INTEGRATION_CREDENTIAL_MASTER_KEY: 'too-short',
      }),
    ).toThrow(/INTEGRATION_CREDENTIAL_MASTER_KEY is too short/);
  });

  it('fails closed at startup when LAZADA_LIVE_ENABLED=true and LAZADA_APP_KEY, LAZADA_APP_SECRET, or LAZADA_OAUTH_STATE_SECRET is missing', () => {
    expect(() =>
      assertIntegrationConfig({
        ...full,
        LAZADA_LIVE_ENABLED: 'true',
      }),
    ).toThrow(/LAZADA_APP_KEY is not set/);

    expect(() =>
      assertIntegrationConfig({
        ...full,
        LAZADA_LIVE_ENABLED: 'true',
        LAZADA_APP_KEY: '123456',
      }),
    ).toThrow(/LAZADA_APP_SECRET is not set/);

    expect(() =>
      assertIntegrationConfig({
        ...full,
        LAZADA_LIVE_ENABLED: 'true',
        LAZADA_APP_KEY: '123456',
        LAZADA_APP_SECRET: 'app_secret_placeholder',
      }),
    ).toThrow(/LAZADA_OAUTH_STATE_SECRET is not set/);

    expect(() =>
      assertIntegrationConfig({
        ...full,
        LAZADA_LIVE_ENABLED: 'true',
        LAZADA_APP_KEY: '123456',
        LAZADA_APP_SECRET: 'app_secret_placeholder',
        LAZADA_OAUTH_STATE_SECRET: 'short',
      }),
    ).toThrow(/LAZADA_OAUTH_STATE_SECRET is too short/);

    expect(() =>
      assertIntegrationConfig({
        ...full,
        LAZADA_LIVE_ENABLED: 'true',
        LAZADA_APP_KEY: '123456',
        LAZADA_APP_SECRET: 'app_secret_placeholder',
        LAZADA_OAUTH_STATE_SECRET: 'state_secret_at_least_16_chars_long',
        LAZADA_CALLBACK_URL:
          'http://api.sapo.makeasy.id.vn/api/v1/integrations/lazada/callback',
      }),
    ).toThrow(/LAZADA_CALLBACK_URL must use https/);

    expect(() =>
      assertIntegrationConfig({
        ...full,
        LAZADA_LIVE_ENABLED: 'true',
        LAZADA_APP_KEY: '123456',
        LAZADA_APP_SECRET: 'app_secret_placeholder',
        LAZADA_OAUTH_STATE_SECRET: 'state_secret_at_least_16_chars_long',
      }),
    ).not.toThrow();
  });

  it('returns default Lazada endpoints when optional URLs are omitted', () => {
    const cfg = readLazadaConfig({
      LAZADA_LIVE_ENABLED: 'false',
    });
    expect(cfg).toEqual({
      liveEnabled: false,
      appKey: null,
      appSecret: null,
      region: 'VN',
      apiBaseUrl: 'https://api.lazada.vn/rest',
      authUrl: 'https://auth.lazada.com/oauth/authorize',
      authApiBaseUrl: 'https://auth.lazada.com/rest',
      authTokenUrl: 'https://auth.lazada.com/rest',
      callbackUrl:
        'https://api.sapo.makeasy.id.vn/api/v1/integrations/lazada/callback',
      oauthStateSecret: null,
      frontendRedirectUrl: null,
      httpTimeoutMs: 10_000,
    });
  });

  it('skips the check under NODE_ENV=test only', () => {
    expect(() => assertIntegrationConfig({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertIntegrationConfig({ NODE_ENV: 'production' })).toThrow();
  });

  it('has no development key: encryption fails without INTEGRATION_CREDENTIAL_MASTER_KEY', () => {
    const saved = process.env.INTEGRATION_CREDENTIAL_MASTER_KEY;
    delete process.env.INTEGRATION_CREDENTIAL_MASTER_KEY;
    try {
      expect(() => encryptCredentialSecret('token')).toThrow(
        'INTEGRATION_CREDENTIAL_MASTER_KEY',
      );
      process.env.INTEGRATION_CREDENTIAL_MASTER_KEY = 'a'.repeat(32);
      const sealed = encryptCredentialSecret('token');
      expect(decryptCredentialSecret(sealed)).toBe('token');
    } finally {
      if (saved === undefined)
        delete process.env.INTEGRATION_CREDENTIAL_MASTER_KEY;
      else process.env.INTEGRATION_CREDENTIAL_MASTER_KEY = saved;
    }
  });
});
