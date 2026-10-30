import {
  Controller,
  DynamicModule,
  Get,
  Inject,
  Module,
  OnApplicationShutdown,
  Optional,
  SetMetadata,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckError,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  TerminusModule,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';

/**
 * Same metadata as @pbl/auth's @Public() (IS_PUBLIC = 'isPublic'), set
 * directly: @pbl/common must not import @pbl/auth, which imports
 * @pbl/common. Pinned by "is public: reachable with the auth guard
 * installed" in the spec.
 */
const Public = () => SetMetadata('isPublic', true);

const HEALTH_OPTIONS = Symbol('PBL_HEALTH_OPTIONS');
const HEALTH_REDIS = Symbol('PBL_HEALTH_REDIS');

export type ReadinessCheck = () => Promise<HealthIndicatorResult>;

export interface PblHealthOptions {
  /** Reported by GET /health and GET /health/live */
  service: string;
  /** Extra readiness checks (database, ...) */
  readiness?: ReadinessCheck[];
  /** Add a PostgreSQL DataSource ping (SELECT 1) when true and DataSource is present */
  database?: boolean;
  /** Add a Redis ping when REDIS_HOST is set */
  redisFromEnv?: boolean;
  /** Readiness gives up on the Redis ping after this long (default 2000 ms) */
  redisTimeoutMs?: number;
}

@ApiTags('health')
@Public()
@Controller('health')
class PblHealthController {
  constructor(
    @Inject(HEALTH_OPTIONS)
    private readonly options: {
      service: string;
      database?: boolean;
      checks: ReadinessCheck[];
    },
    private readonly health: HealthCheckService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Service health check' })
  live() {
    return { status: 'ok', service: this.options.service };
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  liveExplicit() {
    return { status: 'ok', service: this.options.service };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (Database and Redis)' })
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    const checks: ReadinessCheck[] = [
      ...(this.options.database && this.dataSource
        ? [() => pingDatabase(this.dataSource!)]
        : []),
      ...this.options.checks,
    ];
    return this.health.check(checks);
  }
}

class HealthRedisShutdown implements OnApplicationShutdown {
  constructor(private readonly redis: Redis | null) {}

  onApplicationShutdown() {
    this.redis?.disconnect();
  }
}

const DEFAULT_REDIS_TIMEOUT_MS = 2000;

async function pingDatabase(
  dataSource: DataSource,
): Promise<HealthIndicatorResult> {
  try {
    await dataSource.query('SELECT 1');
    return { database: { status: 'up' } };
  } catch (err) {
    throw new HealthCheckError('Database check failed', {
      database: {
        status: 'down',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

async function pingRedis(
  redis: Redis,
  timeoutMs: number,
): Promise<HealthIndicatorResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Redis ping timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
    return { redis: { status: 'up' } };
  } catch (err) {
    // terminus turns a HealthCheckError into a 503 listing the failure
    throw new HealthCheckError('Redis check failed', {
      redis: {
        status: 'down',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

@Module({})
export class PblHealthModule {
  static forRoot(options: PblHealthOptions): DynamicModule {
    return {
      module: PblHealthModule,
      imports: [TerminusModule],
      controllers: [PblHealthController],
      providers: [
        {
          provide: HEALTH_REDIS,
          useFactory: (): Redis | null => {
            if (!options.redisFromEnv || !process.env.REDIS_HOST) return null;
            const redis = new Redis({
              host: process.env.REDIS_HOST,
              port: Number(process.env.REDIS_PORT) || 6379,
              password: process.env.REDIS_PASSWORD || undefined,
              tls: process.env.REDIS_TLS_ENABLED === 'true' ? {} : undefined,
              maxRetriesPerRequest: 1,
              retryStrategy: () => 1000,
            });
            redis.on('error', () => undefined); // reported by the ping
            return redis;
          },
        },
        {
          provide: HEALTH_OPTIONS,
          inject: [HEALTH_REDIS],
          useFactory: (redis: Redis | null) => ({
            service: options.service,
            database: options.database,
            checks: [
              ...(options.readiness ?? []),
              ...(redis
                ? [
                    () =>
                      pingRedis(
                        redis,
                        options.redisTimeoutMs ?? DEFAULT_REDIS_TIMEOUT_MS,
                      ),
                  ]
                : []),
            ],
          }),
        },
        {
          provide: HealthRedisShutdown,
          inject: [HEALTH_REDIS],
          useFactory: (redis: Redis | null) => new HealthRedisShutdown(redis),
        },
      ],
    };
  }
}
