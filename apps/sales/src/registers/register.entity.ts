import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('register')
@Index('UQ_register_tenant_code', ['tenantId', 'code'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Index('IDX_register_tenant_branch', ['tenantId', 'branchId'])
export class RegisterEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_register_id' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** Bare id of a platform branch, checked against the branch projection */
  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** `active` or `inactive` */
  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt!: Date | null;
}
