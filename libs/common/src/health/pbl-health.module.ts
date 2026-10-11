import {
  Controller,
  DynamicModule,
  Get,
  Inject,
  Module,
  OnApplicationShutdown,
  SetMetadata,
} from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckError,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  TerminusModule,
} from '@nestjs/terminus';
import Redis from 'ioredis';

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
  /** Reported by GET /health */
  service: string;
  /** Extra readiness checks (database, ...) */
  readiness?: ReadinessCheck[];
  /** Add a Redis ping when REDIS_HOST is set */
  redisFromEnv?: boolean;
}

@Public()
@Controller('health')
class PblHealthController {
  constructor(
    @Inject(HEALTH_OPTIONS)
    private readonly options: { service: string; checks: ReadinessCheck[] },
    private readonly health: HealthCheckService,
  ) {}

  @Get()
  live() {
    return { status: 'ok', service: this.options.service };
  }

  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check(this.options.checks);
  }
}

class HealthRedisShutdown implements OnApplicationShutdown {
  constructor(private readonly redis: Redis | null) {}

  onApplicationShutdown() {
    this.redis?.disconnect();
  }
}

async function pingRedis(redis: Redis): Promise<HealthIndicatorResult> {
  try {
    await redis.ping();
    return { redis: { status: 'up' } };
  } catch (err) {
    // terminus turns a HealthCheckError into a 503 listing the failure
    throw new HealthCheckError('Redis check failed', {
      redis: {
        status: 'down',
        message: err instanceof Error ? err.message : String(err),
      },
    });
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
            checks: [
              ...(options.readiness ?? []),
              ...(redis ? [() => pingRedis(redis)] : []),
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
