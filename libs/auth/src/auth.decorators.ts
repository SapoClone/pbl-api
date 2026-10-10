import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import {
  IS_AUTH_OPTIONAL,
  IS_PUBLIC,
  IS_TENANT_OPTIONAL,
  REQUIRED_ROLES,
} from './auth.constants';
import { AuthUser } from './auth.types';

/** Skip authentication for this route/controller. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Authenticate when a token is sent, but allow anonymous callers too. */
export const AuthOptional = () => SetMetadata(IS_AUTH_OPTIONAL, true);

/** In `tenant: 'required'` services, allow a token without a selected store. */
export const TenantOptional = () => SetMetadata(IS_TENANT_OPTIONAL, true);

/** Caller must have one of these roles in the selected store (403 otherwise). */
export const RequireRoles = (...roles: string[]) =>
  SetMetadata(REQUIRED_ROLES, roles);

/** The verified caller (AuthUser), or one of its fields: @CurrentUser('id'). */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest()['user'];
    return data ? user?.[data] : user;
  },
);

/** The selected store's id from the token (ADR-0008); 403 if none is selected. */
export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest()['user'];
    if (!user?.tenantId) {
      throw new ForbiddenException('A store must be selected');
    }
    return user.tenantId;
  },
);
