import authConfig from './auth.config';

describe('AuthConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset process.env to its original state before each test
    process.env = { ...originalEnv };
  });

  beforeAll(() => {
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'info').mockImplementation();
  });

  describe('privateKey', () => {
    it('should decode AUTH_JWT_PRIVATE_KEY from base64 to the PEM key', async () => {
      const pem =
        '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n';
      process.env.AUTH_JWT_PRIVATE_KEY = Buffer.from(pem).toString('base64');
      const config = await authConfig();
      expect(config.privateKey).toBe(pem);
    });

    it('should throw an error when AUTH_JWT_PRIVATE_KEY is not base64', async () => {
      process.env.AUTH_JWT_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----';
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });

    it('should throw an error when AUTH_JWT_PRIVATE_KEY is not set', async () => {
      delete process.env.AUTH_JWT_PRIVATE_KEY;
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });
  });

  describe('keyId', () => {
    it('should return the value of AUTH_JWT_KEY_ID', async () => {
      process.env.AUTH_JWT_KEY_ID = 'key-2026-10';
      const config = await authConfig();
      expect(config.keyId).toBe('key-2026-10');
    });

    it('should throw an error when AUTH_JWT_KEY_ID is not set', async () => {
      delete process.env.AUTH_JWT_KEY_ID;
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });
  });

  describe('issuer and audience', () => {
    it('should default to platform and pbl6', async () => {
      delete process.env.AUTH_JWT_ISSUER;
      delete process.env.AUTH_JWT_AUDIENCE;
      const config = await authConfig();
      expect(config.issuer).toBe('platform');
      expect(config.audience).toBe('pbl6');
    });

    it('should use AUTH_JWT_ISSUER and AUTH_JWT_AUDIENCE when set', async () => {
      process.env.AUTH_JWT_ISSUER = 'iss';
      process.env.AUTH_JWT_AUDIENCE = 'aud';
      const config = await authConfig();
      expect(config.issuer).toBe('iss');
      expect(config.audience).toBe('aud');
    });
  });

  describe('expires', () => {
    it('should return the value of AUTH_JWT_TOKEN_EXPIRES_IN', async () => {
      process.env.AUTH_JWT_TOKEN_EXPIRES_IN = '1d';
      const config = await authConfig();
      expect(config.expires).toBe('1d');
    });

    it('should throw an error when AUTH_JWT_TOKEN_EXPIRES_IN is an empty', async () => {
      process.env.AUTH_JWT_TOKEN_EXPIRES_IN = '';
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });

    it('should throw an error when AUTH_JWT_TOKEN_EXPIRES_IN is not set', async () => {
      delete process.env.AUTH_JWT_TOKEN_EXPIRES_IN;
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });

    it('should throw an error when AUTH_JWT_TOKEN_EXPIRES_IN is not a valid ms', async () => {
      process.env.AUTH_JWT_TOKEN_EXPIRES_IN = 'invalid';
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });
  });

  describe('refreshExpires', () => {
    it('should return the value of AUTH_REFRESH_TOKEN_EXPIRES_IN', async () => {
      process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN = '1d';
      const config = await authConfig();
      expect(config.refreshExpires).toBe('1d');
    });

    it('should throw an error when AUTH_REFRESH_TOKEN_EXPIRES_IN is an empty', async () => {
      process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN = '';
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });

    it('should throw an error when AUTH_REFRESH_TOKEN_EXPIRES_IN is not set', async () => {
      delete process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN;
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });

    it('should throw an error when AUTH_REFRESH_TOKEN_EXPIRES_IN is not a valid ms', async () => {
      process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN = 'invalid';
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });
  });

  describe('forgotSecret', () => {
    it('should return the value of AUTH_FORGOT_SECRET', async () => {
      process.env.AUTH_FORGOT_SECRET = 'secret';
      const config = await authConfig();
      expect(config.forgotSecret).toBe('secret');
    });

    it('should throw an error when AUTH_FORGOT_SECRET is an empty', async () => {
      process.env.AUTH_FORGOT_SECRET = '';
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });

    it('should throw an error when AUTH_FORGOT_SECRET is not set', async () => {
      delete process.env.AUTH_FORGOT_SECRET;
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });
  });

  describe('forgotExpires', () => {
    it('should return the value of AUTH_FORGOT_TOKEN_EXPIRES_IN', async () => {
      process.env.AUTH_FORGOT_TOKEN_EXPIRES_IN = '1d';
      const config = await authConfig();
      expect(config.forgotExpires).toBe('1d');
    });

    it('should throw an error when AUTH_FORGOT_TOKEN_EXPIRES_IN is an empty', async () => {
      process.env.AUTH_FORGOT_TOKEN_EXPIRES_IN = '';
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });

    it('should throw an error when AUTH_FORGOT_TOKEN_EXPIRES_IN is not set', async () => {
      delete process.env.AUTH_FORGOT_TOKEN_EXPIRES_IN;
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });

    it('should throw an error when AUTH_FORGOT_TOKEN_EXPIRES_IN is not a valid ms', async () => {
      process.env.AUTH_FORGOT_TOKEN_EXPIRES_IN = 'invalid';
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });
  });

  describe('confirmEmailSecret', () => {
    it('should return the value of AUTH_CONFIRM_EMAIL_SECRET', async () => {
      process.env.AUTH_CONFIRM_EMAIL_SECRET = 'secret';
      const config = await authConfig();
      expect(config.confirmEmailSecret).toBe('secret');
    });

    it('should throw an error when AUTH_CONFIRM_EMAIL_SECRET is an empty', async () => {
      process.env.AUTH_CONFIRM_EMAIL_SECRET = '';
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });

    it('should throw an error when AUTH_CONFIRM_EMAIL_SECRET is not set', async () => {
      delete process.env.AUTH_CONFIRM_EMAIL_SECRET;
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });
  });

  describe('confirmEmailExpires', () => {
    it('should return the value of AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN', async () => {
      process.env.AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN = '1d';
      const config = await authConfig();
      expect(config.confirmEmailExpires).toBe('1d');
    });

    it('should throw an error when AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN is an empty', async () => {
      process.env.AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN = '';
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });

    it('should throw an error when AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN is not set', async () => {
      delete process.env.AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN;
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });

    it('should throw an error when AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN is not a valid ms', async () => {
      process.env.AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN = 'invalid';
      await expect(async () => await authConfig()).rejects.toThrow(Error);
    });
  });
});
