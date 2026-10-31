import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Projection of finance's providers kept in sales so the order form loads in one call */
@Entity('shipping_provider')
@Index('UQ_shipping_provider_tenant_code', ['tenantId', 'code'], {
  unique: true,
})
export class ShippingProviderEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_shipping_provider_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @Column({ type: 'varchar', length: 30 })
  type!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
