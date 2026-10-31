import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { DeviceTokensService } from './device-tokens.service';
import {
  ListNotificationsReqDto,
  RegisterDeviceTokenReqDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * The bell shows on every store screen, so every role may use it (contract: "tenant").
 * Fixed paths come before `:id/read`.
 */
@ApiTags('insight')
@ApiBearerAuth()
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
@Controller('api/v1')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly devices: DeviceTokensService,
  ) {}

  @Get('notifications')
  list(
    @CurrentUser('id') accountId: string,
    @Query() query: ListNotificationsReqDto,
  ) {
    return this.notifications.list(accountId, query);
  }

  @Get('notifications/unread-count')
  unreadCount(@CurrentUser('id') accountId: string) {
    return this.notifications.unreadCount(accountId);
  }

  @Post('notifications/read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  readAll(@CurrentUser('id') accountId: string) {
    return this.notifications.markAllRead(accountId);
  }

  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  read(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(accountId, id);
  }

  @Post('device-tokens')
  register(
    @CurrentUser('id') accountId: string,
    @Body() body: RegisterDeviceTokenReqDto,
  ) {
    return this.devices.register(accountId, body.token, body.platform);
  }

  @Delete('device-tokens/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  unregister(
    @CurrentUser('id') accountId: string,
    @Param('token') token: string,
  ) {
    return this.devices.remove(accountId, token);
  }
}
