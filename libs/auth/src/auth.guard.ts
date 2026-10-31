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
  IS_AUTH_OPTIONAL,
  IS_PUBLIC,
  IS_TENANT_OPTIONAL,
  PBL_AUTH_OPTIONS,
  REQUIRED_PERMISSIONS,
  REQUIRED_ROLES,
} from './auth.constants';
import { hasPermission } from './auth.helpers';
import { PblAuthOptions } from './auth.types';

/**
 * Global guard (registered by PblAuthModule): every route needs a valid
 * Bearer access token unless marked @Public() or @AuthOptional(). In
 * `tenant: 'required'` mode the token must also carry a store (`tid`).
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
      !requiredRoles.some((required) =>
        this.hasRoleOrPermission(user.roles, required),
      )
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

  private hasRoleOrPermission(userRoles: string[], required: string): boolean {
    if (userRoles.includes(required)) {
      return true;
    }
    const normalized = new Set(userRoles.map((r) => r.toLowerCase()));
    if (required.startsWith('finance.')) {
      if (
        normalized.has('owner') ||
        normalized.has('accountant') ||
        normalized.has('manager')
      ) {
        return true;
      }
      if (normalized.has('cashier')) {
        const cashierPermissions = new Set([
          'finance.cashbook.read',
          'finance.cashbook.create',
          'finance.receivable.read',
          'finance.receivable.collect',
          'finance.credit.read',
          'finance.refund.process',
          'finance.shift.reconcile',
        ]);
        return cashierPermissions.has(required);
      }
      return false;
    }
    if (required.startsWith('integration.')) {
      if (normalized.has('owner') || normalized.has('manager')) {
        return true;
      }
      if (normalized.has('cashier')) {
        const cashierIntegrationPermissions = new Set([
          'integration.connection.read',
          'integration.mapping.read',
          'integration.order_sync.read',
          'integration.conflict.read',
          'integration.jobs.read',
          'integration.reconciliation.read',
        ]);
        return cashierIntegrationPermissions.has(required);
      }
      return false;
    }
    return false;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
