import { AccountEntity } from '@/api/account/entities/account.entity';
import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Relation,
} from 'typeorm';
import { TenantEntity } from './tenant.entity';

export enum TenantRole {
  OWNER = 'owner',
  MANAGER = 'manager',
  CASHIER = 'cashier',
}

/** Membership of an account in a store, with its role (ADR-0008). */
@Entity('account_tenant')
export class AccountTenantEntity extends BaseEntity {
  constructor(data?: Partial<AccountTenantEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryColumn({
    name: 'account_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_account_tenant',
  })
  accountId!: string;

  @PrimaryColumn({
    name: 'tenant_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_account_tenant',
  })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: TenantRole;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => AccountEntity)
  @JoinColumn({
    name: 'account_id',
    foreignKeyConstraintName: 'FK_account_tenant_account',
  })
  account?: Relation<AccountEntity>;

  @ManyToOne(() => TenantEntity)
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'FK_account_tenant_tenant',
  })
  tenant?: Relation<TenantEntity>;
}
