import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AccessTokenVerifier } from './access-token.verifier';
import {
  ALLOW_SUPPORT_TOKEN,
  AUTH_READ_ONLY,
  IS_AUTH_OPTIONAL,
  IS_PUBLIC,
  IS_TENANT_OPTIONAL,
  PBL_AUTH_OPTIONS,
  REQUIRED_PERMISSIONS,
  REQUIRED_PLATFORM_ADMIN,
  REQUIRED_ROLES,
} from './auth.constants';
import { hasPermission } from './auth.helpers';
import { PblAuthOptions } from './auth.types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard (registered by PblAuthModule): every route needs a valid
 * Bearer access token unless marked @Public() or @AuthOptional(). In
 * `tenant: 'required'` mode the token must also carry a store (`tid`).
 * Platform-admin tokens are accepted only on @RequirePlatformAdmin routes.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
    @Inject(PBL_AUTH_OPTIONS) private readonly options: PblAuthOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const accessToken = this.extractTokenFromHeader(request);

    if (!accessToken) {
      if (
        this.reflector.getAllAndOverride<boolean>(IS_AUTH_OPTIONAL, targets)
      ) {
        return true;
      }
      throw new UnauthorizedException();
    }

    const user = await this.verifier.verify(accessToken);
    request['user'] = user;

    // A support-session token (ADR-0025) is a read-only store viewer: neither a platform admin nor a member.
    if (user.readOnly) {
      const allowed = !!this.reflector.getAllAndOverride<boolean>(
        ALLOW_SUPPORT_TOKEN,
        targets,
      );
      this.checkReadOnly(request, allowed);
      if (allowed) return true; // the handler verifies `user.actor`
    }

    // Platform admins and store users never mix (ADR-0022): an admin token passes only on a
    // @RequirePlatformAdmin route, and such a route refuses every other token.
    const adminRoles = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRED_PLATFORM_ADMIN,
      targets,
    );
    // the support token's `sub_type` is platform_admin (it names who is acting) but it never passes as an admin
    const isAdminToken =
      user.subjectType === 'platform_admin' && !user.readOnly;
    if (user.readOnly && adminRoles !== undefined) {
      throw new ForbiddenException();
    }
    if (isAdminToken || adminRoles !== undefined) {
      if (!isAdminToken || adminRoles === undefined) {
        throw new ForbiddenException();
      }
      if (
        adminRoles.length > 0 &&
        !adminRoles.some((role) => user.roles.includes(role))
      ) {
        throw new ForbiddenException();
      }
      return true;
    }

    const requiredRoles =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, targets) ?? [];
    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(
        REQUIRED_PERMISSIONS,
        targets,
      ) ?? [];
    const tenantRequired =
      (this.options.tenant ?? 'required') === 'required' &&
      !this.reflector.getAllAndOverride<boolean>(IS_TENANT_OPTIONAL, targets);

    if (
      (tenantRequired ||
        requiredRoles.length > 0 ||
        requiredPermissions.length > 0) &&
      !user.tenantId
    ) {
      throw new ForbiddenException('A store must be selected');
    }
    if (
      requiredRoles.length > 0 &&
      !requiredRoles.some((role) => user.roles.includes(role))
    ) {
      throw new ForbiddenException();
    }
    if (
      requiredPermissions.length > 0 &&
      !hasPermission(user, ...requiredPermissions)
    ) {
      throw new ForbiddenException();
    }
    return true;
  }

  /**
   * Read-only tokens may only read: any method but GET/HEAD/OPTIONS answers 403 AUTH_READ_ONLY before the handler runs,
   * and `/internal/...` routes (service to service) refuse them outright. POST routes that only read (a search by POST)
   * are refused too; that is accepted.
   */
  private checkReadOnly(request: Request, methodAllowed: boolean): void {
    const path = (request.path ?? request.url ?? '').toLowerCase();
    if (/(^|\/)internal(\/|$)/.test(path)) {
      throw new ForbiddenException();
    }
    if (!methodAllowed && !SAFE_METHODS.has(request.method?.toUpperCase())) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: AUTH_READ_ONLY,
        message: 'A support session is read-only',
      });
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
