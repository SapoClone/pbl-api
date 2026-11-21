import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Who did what in a store, written from the events of every service (the
 * "audit log" of insight). The id is the event's id, so one event is one row.
 */
@Entity('audit_log')
@Index('IDX_audit_log_tenant_occurred', ['tenantId', 'occurredAt'])
export class AuditLogEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_audit_log_id',
  })
  id!: string;

  /** Null for a platform-scope row (an action that belongs to no store) */
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'tenant' })
  scope!: 'platform' | 'tenant';

  @Column({
    name: 'actor_type',
    type: 'varchar',
    length: 20,
    default: 'system',
  })
  actorType!: 'platform_admin' | 'member' | 'system';

  @Column({ name: 'actor_name', type: 'varchar', length: 150, nullable: true })
  actorName!: string | null;

  /** The normalised action code (`tenant.updated`); `type` stays the source event type */
  @Column({ type: 'varchar', length: 100 })
  action!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 40, nullable: true })
  targetType!: string | null;

  @Column({ name: 'target_id', type: 'varchar', length: 64, nullable: true })
  targetId!: string | null;

  @Column({ name: 'target_name', type: 'varchar', length: 200, nullable: true })
  targetName!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'success' })
  result!: 'success' | 'failed';

  @Column({ name: 'error_code', type: 'varchar', length: 40, nullable: true })
  errorCode!: string | null;

  @Column({
    name: 'error_message',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  errorMessage!: string | null;

  /** The store's name when the row was written (no tenant projection needed to show it) */
  @Column({ name: 'tenant_name', type: 'varchar', length: 200, nullable: true })
  tenantName!: string | null;

  @Column({ type: 'varchar', length: 150 })
  type!: string;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ type: 'varchar', length: 300 })
  summary!: string;

  @Column({ type: 'jsonb' })
  data!: Record<string, unknown>;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'recorded_at', type: 'timestamptz', default: () => 'now()' })
  recordedAt!: Date;
}
