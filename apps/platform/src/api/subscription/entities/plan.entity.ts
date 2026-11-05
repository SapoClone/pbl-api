import { Uuid } from '@/common/types/common.type';
import { AbstractEntity } from '@/database/entities/abstract.entity';
import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { bigintMoney } from '../money';

export enum PlanStatus {
  ACTIVE = 'active',
  HIDDEN = 'hidden',
}

/** A service plan with its limits (platform admin design). Not tenant-owned; `code` is immutable. */
@Entity('plan')
@Unique('UQ_plan_code', ['code'])
export class PlanEntity extends AbstractEntity {
  constructor(data?: Partial<PlanEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_plan_id' })
  id!: Uuid;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @Column({
    name: 'price_monthly',
    type: 'bigint',
    default: 0,
    transformer: bigintMoney,
  })
  priceMonthly!: number;

  @Column({ type: 'varchar', length: 20, default: PlanStatus.ACTIVE })
  status!: PlanStatus;

  @Column({ name: 'is_featured', type: 'boolean', default: false })
  isFeatured!: boolean;

  @Column({ name: 'quota_branches', type: 'int' })
  quotaBranches!: number;

  @Column({ name: 'quota_users', type: 'int' })
  quotaUsers!: number;

  @Column({ name: 'quota_products', type: 'int' })
  quotaProducts!: number;

  @Column({ name: 'quota_storage_mb', type: 'int' })
  quotaStorageMb!: number;
}
