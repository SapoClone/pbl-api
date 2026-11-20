import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePlatformAdmin } from '@pbl/auth';
import {
  AudiencePreviewReqDto,
  CreateAnnouncementReqDto,
  ListAnnouncementsReqDto,
  SendAnnouncementReqDto,
  UpdateAnnouncementReqDto,
} from './announcements.dto';
import { AnnouncementsService } from './announcements.service';

/**
 * System announcements of the admin area (contract 04, screens 20 and 21). Platform-admin tokens only (super admin and
 * admin): a store token gets 403 (ADR-0022). Stores read them as notifications in their own bell.
 */
@ApiTags('insight-admin')
@ApiBearerAuth()
@RequirePlatformAdmin()
@Controller('api/v1/admin/announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @ApiOperation({
    summary: 'List announcements',
    description:
      'Newest first; `q` is part of the title; `counts` gives the tabs (all, draft, scheduled, sent) for the same `q`, `type`, `from` and `to`.',
  })
  @Get()
  list(@Query() query: ListAnnouncementsReqDto) {
    return this.announcements.list(query);
  }

  @ApiOperation({
    summary: 'How many stores an audience reaches now',
    description: 'An estimate: the stores are resolved again when sent.',
  })
  @HttpCode(HttpStatus.OK)
  @Post('audience-preview')
  preview(@Body() body: AudiencePreviewReqDto) {
    return this.announcements.audiencePreview(body);
  }

  @ApiOperation({ summary: 'One announcement' })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.get(id);
  }

  @ApiOperation({ summary: 'Create a draft' })
  @Post()
  create(
    @Body() body: CreateAnnouncementReqDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.announcements.create(body, { id: adminId });
  }

  @ApiOperation({
    summary: 'Edit a draft',
    description:
      '400 `N001` when already sent, `N003` while scheduled (cancel first).',
  })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAnnouncementReqDto,
  ) {
    return this.announcements.update(id, body);
  }

  @ApiOperation({
    summary: 'Send now or schedule',
    description:
      '`scheduledAt` null or missing sends now; a time in the future schedules it (422 otherwise). 400 `N001` already sent, 400 `N002` the audience has no store.',
  })
  @HttpCode(HttpStatus.OK)
  @Post(':id/send')
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendAnnouncementReqDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.announcements.send(id, body.scheduledAt, { id: adminId });
  }

  @ApiOperation({ summary: 'Take a scheduled announcement back to a draft' })
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminId: string,
  ) {
    return this.announcements.cancel(id, { id: adminId });
  }

  @ApiOperation({ summary: 'Delete a draft' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.announcements.remove(id);
  }
}
