import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * What sales knows about a branch of platform, kept up to date by events
 * (ADR-0002, loại 3). Read-only for the app: only the event handler writes it.
 * An order's `branchId` is checked against it, with the tenant condition.
 */
@Entity('branch_projection')
export class BranchProjectionEntity {
  @PrimaryColumn({
    name: 'branch_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_branch_projection_branch_id',
  })
  branchId!: string;

  @Index('IDX_branch_projection_tenant')
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ name: 'is_warehouse', type: 'boolean' })
  isWarehouse!: boolean;

  /** `active`, `inactive` or `deleted` */
  @Column({ type: 'varchar', length: 20 })
  status!: string;

  /** The source's `updatedAt`: an older event is ignored */
  @Column({ name: 'source_updated_at', type: 'timestamptz' })
  sourceUpdatedAt!: Date;

  @Column({ name: 'synced_at', type: 'timestamptz', default: () => 'now()' })
  syncedAt!: Date;
}
