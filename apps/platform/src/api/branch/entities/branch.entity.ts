import { TenantEntity } from '@/api/tenant/entities/tenant.entity';
import { Uuid } from '@/common/types/common.type';
import { AbstractEntity } from '@/database/entities/abstract.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';

export enum BranchStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/** Created with every new store (P0 spec, flow 2). */
export const DEFAULT_BRANCH = {
  code: 'CN01',
  name: 'Chi nhánh chính',
} as const;

@Entity('branch')
@Index('UQ_branch_tenant_code', ['tenantId', 'code'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class BranchEntity extends AbstractEntity {
  constructor(data?: Partial<BranchEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_branch_id' })
  id!: Uuid;

  @Index('IDX_branch_tenant_id')
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => TenantEntity)
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'FK_branch_tenant',
  })
  tenant?: Relation<TenantEntity>;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ name: 'is_warehouse', type: 'boolean', default: true })
  isWarehouse!: boolean;

  @Column({ type: 'varchar', length: 20, default: BranchStatus.ACTIVE })
  status!: BranchStatus;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', default: null })
  deletedAt: Date;
}
