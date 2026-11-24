import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForgotPasswordReqDto } from './forgot-password.req.dto';
import { ResetPasswordReqDto } from './reset-password.req.dto';

const props = async (cls: new () => object, body: object) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe('ResetPasswordReqDto', () => {
  it('accepts a token and a password that follows the policy', async () => {
    expect(
      await props(ResetPasswordReqDto, {
        token: 'abc',
        password: 'Passw0rd!x',
      }),
    ).toEqual([]);
  });

  it('rejects a password that is too short or has forbidden characters (422 through the pipe)', async () => {
    expect(
      await props(ResetPasswordReqDto, { token: 'abc', password: 'ab1' }),
    ).toContain('password');
    expect(
      await props(ResetPasswordReqDto, {
        token: 'abc',
        password: 'has space 1',
      }),
    ).toContain('password');
  });

  it('requires the token', async () => {
    expect(
      await props(ResetPasswordReqDto, { password: 'Passw0rd!x' }),
    ).toContain('token');
  });
});

describe('ForgotPasswordReqDto', () => {
  it('requires an email', async () => {
    expect(await props(ForgotPasswordReqDto, { email: 'nope' })).toContain(
      'email',
    );
    expect(await props(ForgotPasswordReqDto, { email: 'a@b.vn' })).toEqual([]);
  });
});
