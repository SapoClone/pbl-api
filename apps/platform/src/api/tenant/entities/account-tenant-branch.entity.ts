import { BranchEntity } from '@/api/branch/entities/branch.entity';
import {
  BaseEntity,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Relation,
} from 'typeorm';
import { AccountTenantEntity } from './account-tenant.entity';

/**
 * A branch a member may act in. A member with **no** rows may use every
 * branch (ADR-0020 §8); the owner always may.
 */
@Entity('account_tenant_branch')
export class AccountTenantBranchEntity extends BaseEntity {
  constructor(data?: Partial<AccountTenantBranchEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryColumn({
    name: 'account_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_account_tenant_branch',
  })
  accountId!: string;

  @PrimaryColumn({
    name: 'tenant_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_account_tenant_branch',
  })
  tenantId!: string;

  @PrimaryColumn({
    name: 'branch_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_account_tenant_branch',
  })
  branchId!: string;

  @ManyToOne(() => AccountTenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'account_id', referencedColumnName: 'accountId' },
    { name: 'tenant_id', referencedColumnName: 'tenantId' },
  ])
  member?: Relation<AccountTenantEntity>;

  @ManyToOne(() => BranchEntity)
  @JoinColumn({
    name: 'branch_id',
    foreignKeyConstraintName: 'FK_account_tenant_branch_branch',
  })
  branch?: Relation<BranchEntity>;
}
