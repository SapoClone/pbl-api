import { Injectable } from '@nestjs/common';
import {
  PLATFORM_SETTINGS_CHANGED,
  PlatformSettingsChangedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { DataSource } from 'typeorm';
import { PlatformSettingEntity } from '../platform-setting/entities/platform-setting.entity';
import { GRACE_DAYS } from '../subscription/expiry';
import { diffFields, isSecretKey, loadAdminActor } from './admin-actor';
import { UpdateSettingsReqDto } from './dto/admin-setting.req.dto';

export type PlatformSettings = {
  general: {
    platformName: string;
    supportEmail: string;
    timezone: string;
    dateFormat: string;
    currency: string;
    defaultLocale: string;
  };
  security: {
    lockoutMaxAttempts: number;
    lockoutWindowMinutes: number;
    resetLinkTtlMinutes: number;
    resetLinkSingleUse: boolean;
    auditRetentionMonths: number;
  };
  email: { senderName: string; senderEmail: string };
  /** `graceDays`: days a paid plan keeps its limits after its end date, before it falls back to `free` */
  billing: { graceDays: number };
};

/** `{ general: { timezone } }` -> `{ 'general.timezone': ... }`, secret-looking keys left out */
function flatten(settings: PlatformSettings): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [group, values] of Object.entries(settings)) {
    for (const [key, value] of Object.entries(values as object)) {
      if (!isSecretKey(`${group}.${key}`)) flat[`${group}.${key}`] = value;
    }
  }
  return flat;
}

/** What a setting is until an admin changes it (contract 04, "System settings") */
export const DEFAULT_SETTINGS: PlatformSettings = {
  general: {
    platformName: 'Omniretail',
    supportEmail: 'support@omniretail.vn',
    timezone: 'Asia/Ho_Chi_Minh',
    dateFormat: 'dd/mm/yyyy',
    currency: 'VND',
    defaultLocale: 'vi',
  },
  security: {
    lockoutMaxAttempts: 5,
    lockoutWindowMinutes: 15,
    resetLinkTtlMinutes: 15,
    resetLinkSingleUse: true,
    auditRetentionMonths: 12,
  },
  email: {
    senderName: 'Omniretail',
    senderEmail: 'no-reply@omniretail.vn',
  },
  billing: { graceDays: GRACE_DAYS },
};

/**
 * The settings of the whole platform, one `platform_setting` row per key (`general.timezone`). A key without a row has
 * its default, so nothing is seeded. Read at run time: `security.lockoutMaxAttempts` and `lockoutWindowMinutes` (both sign-ins, minimum 3 attempts,
 * through `PlatformSettingReader`, cached 30 s) and `billing.graceDays` (the expiry job). The other values wait for the
 * flows they belong to.
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
  ) {}

  async get(): Promise<PlatformSettings> {
    const rows = await this.dataSource
      .getRepository(PlatformSettingEntity)
      .find();
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    const settings = structuredClone(DEFAULT_SETTINGS) as Record<
      string,
      Record<string, unknown>
    >;
    for (const [group, keys] of Object.entries(settings)) {
      for (const key of Object.keys(keys)) {
        const value = stored.get(`${group}.${key}`);
        if (value !== undefined) keys[key] = value;
      }
    }
    return settings as unknown as PlatformSettings;
  }

  async update(
    adminId: string,
    dto: UpdateSettingsReqDto,
  ): Promise<PlatformSettings> {
    const changes: PlatformSettingEntity[] = [];
    for (const [group, values] of Object.entries(dto)) {
      for (const [key, value] of Object.entries(values ?? {})) {
        if (value === undefined) continue;
        changes.push(
          new PlatformSettingEntity({
            key: `${group}.${key}`,
            value,
            updatedAt: new Date(),
            updatedBy: adminId,
          }),
        );
      }
    }
    if (changes.length > 0) {
      const before = flatten(await this.get());
      await this.dataSource.transaction(async (em) => {
        await em.save(changes);
        // the keys that really changed, before and after; a secret-looking key is never put in the event
        const after = { ...before };
        for (const row of changes) after[row.key] = row.value;
        const diff = diffFields(before, after);
        const keys = Object.keys(diff);
        if (keys.length === 0) return;
        const payload: PlatformSettingsChangedPayload = {
          actor: await loadAdminActor(em, adminId),
          keys,
          changes: diff,
        };
        await this.outbox.add(em, PLATFORM_SETTINGS_CHANGED, payload, {
          tenantId: null,
        });
      });
    }
    return this.get();
  }
}
