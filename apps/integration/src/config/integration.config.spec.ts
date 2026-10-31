import {
  decryptCredentialSecret,
  encryptCredentialSecret,
} from '../domain/integration-domain';
import { assertIntegrationConfig } from './integration.config';

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
