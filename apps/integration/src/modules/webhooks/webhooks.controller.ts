import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@pbl/auth';
import type { Request } from 'express';
import { rethrowIntegrationHttpError } from '../../presentation/integration-http-error';
import { WebhooksService } from './webhooks.service';

@ApiTags('integration-webhooks')
@Controller('webhooks/v1')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post(':provider/:connectionKey')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ingest and verify external marketplace webhook (Shopee v2 / Lazada) with raw-body HMAC verification and durable inbox persistence',
  })
  async receiveWebhook(
    @Param('provider') provider: string,
    @Param('connectionKey') connectionKey: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    try {
      const rawBody =
        req.rawBody ??
        Buffer.from(
          typeof req.body === 'string'
            ? req.body
            : JSON.stringify(req.body ?? {}),
          'utf8',
        );
      const webhookUrl =
        (headers['x-webhook-url'] as string | undefined) ??
        `${req.protocol}://${req.get('host')}${req.originalUrl}`;

      return await this.webhooksService.ingestWebhook({
        provider,
        connectionKey,
        webhookUrl,
        rawBody,
        headers,
      });
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }
}
