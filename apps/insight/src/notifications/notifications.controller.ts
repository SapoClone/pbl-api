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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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

  @ApiOperation({
    summary: 'List my notifications',
    description:
      "The caller's notifications, newest first; `unread=true` keeps the unread ones. No permission needed.",
  })
  @Get('notifications')
  list(
    @CurrentUser('id') accountId: string,
    @Query() query: ListNotificationsReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.notifications.list(accountId, query, scope);
  }

  @ApiOperation({
    summary: 'Count my unread notifications',
    description:
      "Number shown on the bell badge, within the caller's branch scope.",
  })
  @Get('notifications/unread-count')
  unreadCount(
    @CurrentUser('id') accountId: string,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.notifications.unreadCount(accountId, scope);
  }

  @ApiOperation({
    summary: 'Mark all my notifications read',
    description:
      'Marks every notification of the caller (in scope) as read. 204 on success.',
  })
  @Post('notifications/read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  readAll(
    @CurrentUser('id') accountId: string,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.notifications.markAllRead(accountId, scope);
  }

  @ApiOperation({
    summary: 'Mark one notification read',
    description:
      '204 on success; a notification of another account or branch out of scope is 404.',
  })
  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  read(
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.notifications.markRead(accountId, id, scope);
  }

  @ApiOperation({
    summary: 'Register a push device token',
    description:
      "Stores the caller's mobile or web push token; registering the same token again is harmless.",
  })
  @Post('device-tokens')
  register(
    @CurrentUser('id') accountId: string,
    @Body() body: RegisterDeviceTokenReqDto,
  ) {
    return this.devices.register(accountId, body.token, body.platform);
  }

  @ApiOperation({
    summary: 'Remove a push device token',
    description:
      'Called on sign-out so the device stops receiving pushes. 204 on success.',
  })
  @Delete('device-tokens/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  unregister(
    @CurrentUser('id') accountId: string,
    @Param('token') token: string,
  ) {
    return this.devices.remove(accountId, token);
  }
}
