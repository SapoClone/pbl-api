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
import { AllowedBranches, CurrentUser } from '@pbl/auth';
import { DeviceTokensService } from './device-tokens.service';
import {
  ListNotificationsReqDto,
  RegisterDeviceTokenReqDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * The bell shows on every store screen, so every member of the store may use it: no
 * permission (ADR-0020 §7). A restricted caller sees notifications of no branch or of
 * an allowed branch. Fixed paths come before `:id/read`.
 */
@ApiTags('insight')
@ApiBearerAuth()
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
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.notifications.list(accountId, query, scope);
  }

  @Get('notifications/unread-count')
  unreadCount(
    @CurrentUser('id') accountId: string,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.notifications.unreadCount(accountId, scope);
  }

  @Post('notifications/read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  readAll(
    @CurrentUser('id') accountId: string,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.notifications.markAllRead(accountId, scope);
  }

  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  read(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.notifications.markRead(accountId, id, scope);
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
