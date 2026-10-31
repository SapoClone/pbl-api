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

export enum MemberStatus {
  ACTIVE = 'active',
  LOCKED = 'locked',
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

  /** A locked member keeps the row but cannot sign in to or switch into the store */
  @Column({ type: 'varchar', length: 20, default: MemberStatus.ACTIVE })
  status!: MemberStatus;

  /** Readable per-store code (NV001, ...); unique within the store */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

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
