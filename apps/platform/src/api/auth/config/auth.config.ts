import { IsMs } from '@/decorators/validators/is-ms.decorator';
import validateConfig from '@/utils/validate-config';
import { registerAs } from '@nestjs/config';
import { IsBase64, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AuthConfig } from './auth-config.type';

class EnvironmentVariablesValidator {
  // Base64 of a PEM-encoded RSA private key (>= 2048 bits) that signs
  // access tokens with RS256. Base64 so it fits on one line in env files
  // and SSM. Generate: openssl genpkey -algorithm RSA -pkeyopt
  // rsa_keygen_bits:2048 | base64 -w0
  @IsString()
  @IsNotEmpty()
  @IsBase64()
  AUTH_JWT_PRIVATE_KEY: string;

  // "kid" of AUTH_JWT_PRIVATE_KEY, published in the JWKS and token header.
  // Change it whenever the key changes.
  @IsString()
  @IsNotEmpty()
  AUTH_JWT_KEY_ID: string;

  @IsString()
  @IsOptional()
  AUTH_JWT_ISSUER: string;

  @IsString()
  @IsOptional()
  AUTH_JWT_AUDIENCE: string;

  @IsString()
  @IsNotEmpty()
  @IsMs()
  AUTH_JWT_TOKEN_EXPIRES_IN: string;

  @IsString()
  @IsNotEmpty()
  @IsMs()
  AUTH_REFRESH_TOKEN_EXPIRES_IN: string;

  @IsString()
  @IsNotEmpty()
  AUTH_FORGOT_SECRET: string;

  @IsString()
  @IsNotEmpty()
  @IsMs()
  AUTH_FORGOT_TOKEN_EXPIRES_IN: string;

  @IsString()
  @IsNotEmpty()
  AUTH_CONFIRM_EMAIL_SECRET: string;

  @IsString()
  @IsNotEmpty()
  @IsMs()
  AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN: string;
}

export default registerAs<AuthConfig>('auth', () => {
  console.info(`Register AuthConfig from environment variables`);
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    privateKey: Buffer.from(
      process.env.AUTH_JWT_PRIVATE_KEY,
      'base64',
    ).toString('utf8'),
    keyId: process.env.AUTH_JWT_KEY_ID,
    issuer: process.env.AUTH_JWT_ISSUER || 'platform',
    audience: process.env.AUTH_JWT_AUDIENCE || 'pbl6',
    expires: process.env.AUTH_JWT_TOKEN_EXPIRES_IN,
    refreshExpires: process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN,
    forgotSecret: process.env.AUTH_FORGOT_SECRET,
    forgotExpires: process.env.AUTH_FORGOT_TOKEN_EXPIRES_IN,
    confirmEmailSecret: process.env.AUTH_CONFIRM_EMAIL_SECRET,
    confirmEmailExpires: process.env.AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN,
  };
});
