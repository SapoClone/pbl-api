import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GRACE_DAYS } from '../subscription/expiry';
import { PlatformSettingEntity } from './entities/platform-setting.entity';

/** Days a paid plan keeps its limits after its end date (D31); the default of `billing.graceDays` */
export const DEFAULT_GRACE_DAYS = GRACE_DAYS;
/** Defaults of `security.lockoutMaxAttempts` / `security.lockoutWindowMinutes` (the Figma policy: 5 failures, 15 minutes) */
export const DEFAULT_LOCKOUT_MAX_ATTEMPTS = 5;
export const DEFAULT_LOCKOUT_WINDOW_MINUTES = 15;
/** The lockout never gets laxer than this, whatever a stored value says (D36) */
export const MIN_LOCKOUT_ATTEMPTS = 3;

const CACHE_MS = 30_000;

/**
 * The few platform settings other flows read at run time (the full set is `AdminSettingsService`). A value is cached for
 * 30 seconds, so a change reaches every instance within that time. A missing or malformed row gives the default.
 */
@Injectable()
export class PlatformSettingReader {
  private readonly logger = new Logger(PlatformSettingReader.name);
  private cache: { at: number; values: Map<string, unknown> } | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async graceDays(now = Date.now()): Promise<number> {
    const value = await this.int('billing.graceDays', now);
    return value !== null && value >= 0 ? value : DEFAULT_GRACE_DAYS;
  }

  async lockout(
    now = Date.now(),
  ): Promise<{ maxAttempts: number; windowMs: number }> {
    const max = await this.int('security.lockoutMaxAttempts', now);
    const window = await this.int('security.lockoutWindowMinutes', now);
    const minutes =
      window !== null && window >= 1 ? window : DEFAULT_LOCKOUT_WINDOW_MINUTES;
    return {
      maxAttempts: Math.max(
        MIN_LOCKOUT_ATTEMPTS,
        max ?? DEFAULT_LOCKOUT_MAX_ATTEMPTS,
      ),
      windowMs: minutes * 60 * 1000,
    };
  }

  private async int(key: string, now: number): Promise<number | null> {
    if (!this.cache || now - this.cache.at > CACHE_MS) {
      try {
        const rows = await this.dataSource
          .getRepository(PlatformSettingEntity)
          .find();
        this.cache = {
          at: now,
          values: new Map(rows.map((r) => [r.key, r.value])),
        };
      } catch (error) {
        // a sign-in or the expiry job must not fail because settings cannot be read: use the defaults, ask again soon
        this.logger.warn(
          `Could not read the platform settings, using defaults: ${error instanceof Error ? error.message : error}`,
        );
        return null;
      }
    }
    const value = this.cache.values.get(key);
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
  }

  /** For tests: forget what was read */
  invalidate(): void {
    this.cache = null;
  }
}
