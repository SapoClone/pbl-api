import { Uuid } from '@/common/types/common.type';
import { AbstractEntity } from '@/database/entities/abstract.entity';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { PlanEntity } from './plan.entity';

export enum SubscriptionStatus {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

/** The statuses of a store's current subscription: at most one such row per store. */
export const CURRENT_SUBSCRIPTION_STATUSES = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
];

export enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

/** A store's plan over a period. A closed subscription stays as history; `expiresAt` is null for `free`. */
@Entity('subscription')
@Unique('UQ_subscription_code', ['code'])
@Index('UQ_subscription_current_tenant', ['tenantId'], {
  unique: true,
  where: `"status" IN ('trialing', 'active', 'past_due')`,
})
export class SubscriptionEntity extends AbstractEntity {
  constructor(data?: Partial<SubscriptionEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_subscription_id',
  })
  id!: Uuid;

  @Column({ type: 'varchar', length: 12 })
  code!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @ManyToOne(() => PlanEntity, {
    nullable: false,
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'plan_id' })
  plan?: PlanEntity;

  @Column({
    name: 'billing_cycle',
    type: 'varchar',
    length: 20,
    default: BillingCycle.MONTHLY,
  })
  billingCycle!: BillingCycle;

  @Column({ type: 'varchar', length: 20, default: SubscriptionStatus.ACTIVE })
  status!: SubscriptionStatus;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;
}
