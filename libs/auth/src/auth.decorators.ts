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
  REQUIRED_PERMISSIONS,
  REQUIRED_PLATFORM_ADMIN,
  REQUIRED_ROLES,
} from './auth.constants';
import { allowedBranches } from './auth.helpers';
import { AuthenticatedContext, AuthUser } from './auth.types';

/** Skip authentication for this route/controller. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Authenticate when a token is sent, but allow anonymous callers too. */
export const AuthOptional = () => SetMetadata(IS_AUTH_OPTIONAL, true);

/** In `tenant: 'required'` services, allow a token without a selected store. */
export const TenantOptional = () => SetMetadata(IS_TENANT_OPTIONAL, true);

/** Caller must have one of these roles in the selected store (403 otherwise). */
export const RequireRoles = (...roles: string[]) =>
  SetMetadata(REQUIRED_ROLES, roles);

/**
 * Caller needs AT LEAST ONE of these permission codes in the selected store
 * (`'*'` in the token passes any); 403 otherwise, also without a store. Combined
 * with @RequireRoles the caller must satisfy both.
 */
export const RequirePermission = (...codes: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, codes);

/**
 * Marks a route or controller as a platform-admin route (ADR-0022): only a token with
 * `sub_type = platform_admin` passes, and with roles given the admin must hold one of them (403 otherwise).
 * A platform-admin token passes on no other route, and a store token passes on none of these: the two
 * identities never mix. A handler's roles override its controller's. Admin tokens carry no store, so
 * the store requirement does not apply.
 */
export const RequirePlatformAdmin = (...roles: string[]) =>
  SetMetadata(REQUIRED_PLATFORM_ADMIN, roles);

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

/** Branch ids the caller may act in, or null for every branch (see allowedBranches). */
export const AllowedBranches = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string[] | null => {
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest()['user'];
    if (!user) throw new ForbiddenException('A store must be selected');
    return allowedBranches(user);
  },
);

/** Verified caller and required store context for tenant-scoped microservices. */
export const CurrentContext = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedContext => {
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest()['user'];
    if (!user?.tenantId) {
      throw new ForbiddenException('A store must be selected');
    }
    return {
      userId: user.id ?? 'system',
      tenantId: user.tenantId,
      roles: user.roles ?? [],
      sessionId: user.sessionId,
      subjectType: user.subjectType,
    };
  },
);
