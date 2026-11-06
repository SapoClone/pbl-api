import { Uuid } from '@/common/types/common.type';
import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum SubscriptionEventType {
  CREATED = 'created',
  RENEWED = 'renewed',
  UPGRADED = 'upgraded',
  DOWNGRADED = 'downgraded',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export enum SubscriptionActorType {
  SYSTEM = 'system',
  ACCOUNT = 'account',
  PLATFORM_ADMIN = 'platform_admin',
}

/** Append-only history behind the subscription detail screen; the actor's name is resolved when it is read. */
@Entity('subscription_event')
@Index('IDX_subscription_event_subscription', ['subscriptionId', 'createdAt'])
export class SubscriptionEventEntity extends BaseEntity {
  constructor(data?: Partial<SubscriptionEventEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_subscription_event_id',
  })
  id!: Uuid;

  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 20 })
  eventType!: SubscriptionEventType;

  @Column({ name: 'plan_code', type: 'varchar', length: 30 })
  planCode!: string;

  @Column({ name: 'effective_until', type: 'date', nullable: true })
  effectiveUntil!: string | null;

  @Column({ name: 'actor_type', type: 'varchar', length: 20 })
  actorType!: SubscriptionActorType;

  @Column({ name: 'actor_id', type: 'varchar', nullable: true })
  actorId!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
