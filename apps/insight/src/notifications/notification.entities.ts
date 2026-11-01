import { Column, Entity, PrimaryColumn } from 'typeorm';

export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** A store-wide notification; who has read it lives in `notification_read` */
@Entity('notification')
export class NotificationEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_notification_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 50 })
  type!: string;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Column({ name: 'ref_type', type: 'varchar', length: 50, nullable: true })
  refType!: string | null;

  @Column({ name: 'ref_id', type: 'varchar', length: 100, nullable: true })
  refId!: string | null;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'info' })
  severity!: Severity;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}

@Entity('notification_read')
export class NotificationReadEntity {
  @PrimaryColumn({ name: 'notification_id', type: 'uuid' })
  notificationId!: string;

  @PrimaryColumn({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ name: 'read_at', type: 'timestamptz', default: () => 'now()' })
  readAt!: Date;
}

@Entity('device_token')
export class DeviceTokenEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_device_token_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ type: 'varchar', length: 512 })
  token!: string;

  @Column({ type: 'varchar', length: 10 })
  platform!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}

export const NOTIFICATION_ENTITIES = [
  NotificationEntity,
  NotificationReadEntity,
  DeviceTokenEntity,
];
