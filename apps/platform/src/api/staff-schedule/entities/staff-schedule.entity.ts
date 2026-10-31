import { AccountEntity } from '@/api/account/entities/account.entity';
import { BranchEntity } from '@/api/branch/entities/branch.entity';
import { TenantEntity } from '@/api/tenant/entities/tenant.entity';
import { Uuid } from '@/common/types/common.type';
import { AbstractEntity } from '@/database/entities/abstract.entity';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';

/**
 * A weekly recurring shift of a member in a branch ("Ca làm việc").
 * `weekday` is ISO: 1 = Monday ... 7 = Sunday. Times are wall-clock times in
 * the store's timezone (Asia/Ho_Chi_Minh until tenants have one).
 */
@Entity('staff_schedule')
@Index('IDX_staff_schedule_tenant_account', [
  'tenantId',
  'accountId',
  'weekday',
])
export class StaffScheduleEntity extends AbstractEntity {
  constructor(data?: Partial<StaffScheduleEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_staff_schedule_id',
  })
  id!: Uuid;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => TenantEntity)
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'FK_staff_schedule_tenant',
  })
  tenant?: Relation<TenantEntity>;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @ManyToOne(() => AccountEntity)
  @JoinColumn({
    name: 'account_id',
    foreignKeyConstraintName: 'FK_staff_schedule_account',
  })
  account?: Relation<AccountEntity>;

  @Index('IDX_staff_schedule_branch_id')
  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @ManyToOne(() => BranchEntity)
  @JoinColumn({
    name: 'branch_id',
    foreignKeyConstraintName: 'FK_staff_schedule_branch',
  })
  branch?: Relation<BranchEntity>;

  @Column({ type: 'smallint' })
  weekday!: number;

  /** 'HH:MM:SS' as Postgres returns it */
  @Column({ name: 'start_time', type: 'time' })
  startTime!: string;

  @Column({ name: 'end_time', type: 'time' })
  endTime!: string;
}
