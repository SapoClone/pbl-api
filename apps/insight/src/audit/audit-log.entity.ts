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

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

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
