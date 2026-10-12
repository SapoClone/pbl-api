import { AllConfigType } from '@/config/config.type';
import { Environment } from '@/constants/app.constant';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckError,
  HealthCheckResult,
  HealthCheckService,
  HttpHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '@pbl/auth';
import { Cache } from 'cache-manager';

const REDIS_PING_TIMEOUT_MS = 2000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private configService: ConfigService<AllConfigType>,
    private health: HealthCheckService,
    private http: HttpHealthIndicator,
    private db: TypeOrmHealthIndicator,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  @Public()
  @ApiOperation({ summary: 'Health check' })
  @Get()
  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
    const list = [
      () => this.db.pingCheck('database'),
      ...(this.configService.get('app.nodeEnv', { infer: true }) ===
      Environment.DEVELOPMENT
        ? [
            () =>
              this.http.pingCheck(
                'api-docs',
                `${this.configService.get('app.url', { infer: true })}/api-docs`,
              ),
          ]
        : []),
    ];
    return this.health.check(list);
  }

  @Public()
  @ApiOperation({ summary: 'Readiness check (database and Redis)' })
  @Get('ready')
  @HealthCheck()
  async ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('database'),
      async () => {
        let timer: NodeJS.Timeout | undefined;
        try {
          // The cache store is the ioredis client platform already holds.
          // A hung connection must not hang the probe: give up after 2 s.
          await Promise.race([
            (this.cache.store as any).client.ping(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      `Redis ping timed out after ${REDIS_PING_TIMEOUT_MS} ms`,
                    ),
                  ),
                REDIS_PING_TIMEOUT_MS,
              );
            }),
          ]);
          return { redis: { status: 'up' } };
        } catch (err) {
          throw new HealthCheckError('Redis check failed', {
            redis: {
              status: 'down',
              message: err instanceof Error ? err.message : String(err),
            },
          });
        } finally {
          clearTimeout(timer);
        }
      },
    ]);
  }
}
