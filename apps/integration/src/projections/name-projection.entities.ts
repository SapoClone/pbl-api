import { Column, Entity, PrimaryColumn } from 'typeorm';

/** The name of a store, kept up to date by `platform.tenant.created` / `.updated` (read by the admin routes only) */
@Entity('tenant_projection')
export class TenantProjectionEntity {
  @PrimaryColumn({
    name: 'tenant_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_tenant_projection_tenant_id',
  })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** `updatedAt` of the last event applied: an older one is ignored */
  @Column({ name: 'source_updated_at', type: 'timestamptz' })
  sourceUpdatedAt!: Date;
}

/** The name of a branch, kept up to date by `platform.branch.created` / `.updated` */
@Entity('branch_projection')
export class BranchProjectionEntity {
  @PrimaryColumn({
    name: 'branch_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_branch_projection_branch_id',
  })
  branchId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'source_updated_at', type: 'timestamptz' })
  sourceUpdatedAt!: Date;
}
