import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessTokenVerifier } from './access-token.verifier';
import {
  AuthOptional,
  Public,
  RequireRoles,
  TenantOptional,
} from './auth.decorators';
import { AuthGuard } from './auth.guard';
import { AuthUser, PblAuthOptions } from './auth.types';

class Handlers {
  plain() {}
  @Public() open() {}
  @AuthOptional() maybe() {}
  @TenantOptional() noTenant() {}
  @RequireRoles('owner') ownerOnly() {}
}

const user = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u1',
  sessionId: 's1',
  subjectType: 'account',
  roles: [],
  exp: 0,
  ...overrides,
});

describe('AuthGuard', () => {
  const verifier = { verify: jest.fn() } as unknown as AccessTokenVerifier & {
    verify: jest.Mock;
  };
  const guardFor = (tenant: PblAuthOptions['tenant']) =>
    new AuthGuard(new Reflector(), verifier, { tenant } as PblAuthOptions);
  const context = (handler: keyof Handlers, authorization?: string) => {
    const request: Record<string, unknown> = {
      headers: authorization ? { authorization } : {},
    };
    return {
      ctx: {
        getHandler: () => Handlers.prototype[handler],
        getClass: () => Handlers,
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext,
      request,
    };
  };

  beforeEach(() => jest.resetAllMocks());

  it('lets @Public() routes through without a token', async () => {
    await expect(
      guardFor('required').canActivate(context('open').ctx),
    ).resolves.toBe(true);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('lets @AuthOptional() routes through without a token', async () => {
    await expect(
      guardFor('required').canActivate(context('maybe').ctx),
    ).resolves.toBe(true);
  });

  it('rejects a protected route without a token (401)', async () => {
    await expect(
      guardFor('optional').canActivate(context('plain').ctx),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('sets request.user from a valid token', async () => {
    verifier.verify.mockResolvedValue(user({ tenantId: 't1' }));
    const { ctx, request } = context('plain', 'Bearer abc');

    await expect(guardFor('required').canActivate(ctx)).resolves.toBe(true);
    expect(verifier.verify).toHaveBeenCalledWith('abc');
    expect(request.user).toMatchObject({ tenantId: 't1' });
  });

  it('in required mode, rejects a token without tid (403)', async () => {
    verifier.verify.mockResolvedValue(user());

    await expect(
      guardFor('required').canActivate(context('plain', 'Bearer abc').ctx),
    ).rejects.toThrow(ForbiddenException);
  });

  it('in required mode, @TenantOptional() accepts a token without tid', async () => {
    verifier.verify.mockResolvedValue(user());

    await expect(
      guardFor('required').canActivate(context('noTenant', 'Bearer abc').ctx),
    ).resolves.toBe(true);
  });

  it('defaults to required mode when the option is missing', async () => {
    verifier.verify.mockResolvedValue(user());

    await expect(
      guardFor(undefined).canActivate(context('plain', 'Bearer abc').ctx),
    ).rejects.toThrow(ForbiddenException);
  });

  it('in optional mode, accepts a token without tid', async () => {
    verifier.verify.mockResolvedValue(user());

    await expect(
      guardFor('optional').canActivate(context('plain', 'Bearer abc').ctx),
    ).resolves.toBe(true);
  });

  it('@RequireRoles() rejects a caller without the role (403), even in optional mode', async () => {
    verifier.verify.mockResolvedValue(
      user({ tenantId: 't1', roles: ['staff'] }),
    );

    await expect(
      guardFor('optional').canActivate(context('ownerOnly', 'Bearer abc').ctx),
    ).rejects.toThrow(ForbiddenException);
  });

  it('@RequireRoles() rejects a caller without a tenant (403)', async () => {
    verifier.verify.mockResolvedValue(user({ roles: ['owner'] }));

    await expect(
      guardFor('optional').canActivate(context('ownerOnly', 'Bearer abc').ctx),
    ).rejects.toThrow(ForbiddenException);
  });

  it('@RequireRoles() accepts a caller with the role', async () => {
    verifier.verify.mockResolvedValue(
      user({ tenantId: 't1', roles: ['owner'] }),
    );

    await expect(
      guardFor('optional').canActivate(context('ownerOnly', 'Bearer abc').ctx),
    ).resolves.toBe(true);
  });
});
