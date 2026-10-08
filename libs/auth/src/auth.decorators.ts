import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { IS_AUTH_OPTIONAL, IS_PUBLIC } from './auth.constants';
import { AuthUser } from './auth.types';

/** Skip authentication for this route/controller. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Authenticate when a token is sent, but allow anonymous callers too. */
export const AuthOptional = () => SetMetadata(IS_AUTH_OPTIONAL, true);

/** The verified caller (AuthUser), or one of its fields: @CurrentUser('id'). */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest()['user'];
    return data ? user?.[data] : user;
  },
);
