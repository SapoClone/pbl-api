import { Column, Entity, PrimaryColumn } from 'typeorm';

/** One setting of the whole platform, keyed `<group>.<name>` (`security.lockoutMaxAttempts`); the value is JSON */
@Entity('platform_setting')
export class PlatformSettingEntity {
  constructor(data?: Partial<PlatformSettingEntity>) {
    Object.assign(this, data);
  }

  @PrimaryColumn({
    type: 'varchar',
    length: 64,
    primaryKeyConstraintName: 'PK_platform_setting_key',
  })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: unknown;

  @Column({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
