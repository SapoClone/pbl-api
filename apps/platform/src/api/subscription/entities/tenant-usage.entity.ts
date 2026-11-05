import { BaseEntity, Column, Entity, PrimaryColumn } from 'typeorm';

/** What a store uses against its plan. Platform counts branches and members; catalog reports products and storage. */
@Entity('tenant_usage')
export class TenantUsageEntity extends BaseEntity {
  constructor(data?: Partial<TenantUsageEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryColumn({
    name: 'tenant_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_tenant_usage_tenant_id',
  })
  tenantId!: string;

  @Column({ name: 'branches_used', type: 'int', default: 0 })
  branchesUsed!: number;

  @Column({ name: 'users_used', type: 'int', default: 0 })
  usersUsed!: number;

  @Column({ name: 'products_used', type: 'int', default: 0 })
  productsUsed!: number;

  @Column({ name: 'storage_mb_used', type: 'int', default: 0 })
  storageMbUsed!: number;

  @Column({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date;
}
