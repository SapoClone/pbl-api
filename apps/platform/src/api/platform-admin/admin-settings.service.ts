import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PlatformSettingEntity } from '../platform-setting/entities/platform-setting.entity';
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
};

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
};

/**
 * The settings of the whole platform, one `platform_setting` row per key (`general.timezone`). A key without a row has
 * its default, so nothing is seeded. Stored and validated, not yet read by the services they describe: the sign-in
 * lockout still uses its constants (contract 04), and the other values wait for the flows they belong to.
 */
@Injectable()
export class AdminSettingsService {
  constructor(private readonly dataSource: DataSource) {}

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
      await this.dataSource.getRepository(PlatformSettingEntity).save(changes);
    }
    return this.get();
  }
}
