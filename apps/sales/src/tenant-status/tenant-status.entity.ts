import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * What sales knows about a store's status and plan, kept up to date by platform's events (ADR-0002, projection).
 * Read-only for the app: only the event handler writes it. A store with no row is treated as active, so a store that
 * predates the events (or an event not yet delivered) is never locked out by mistake.
 */
@Entity('tenant_status')
export class TenantStatusEntity {
  @PrimaryColumn({
    name: 'tenant_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_tenant_status_tenant_id',
  })
  tenantId!: string;

  /** `active` or `suspended` (platform's tenant status) */
  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: string;

  @Column({ name: 'plan_code', type: 'varchar', length: 30, nullable: true })
  planCode!: string | null;

  /** `occurredAt` of the last status event applied: an older one is ignored */
  @Column({ name: 'status_changed_at', type: 'timestamptz' })
  statusChangedAt!: Date;

  /** `occurredAt` of the last plan event applied */
  @Column({ name: 'plan_changed_at', type: 'timestamptz' })
  planChangedAt!: Date;
}
