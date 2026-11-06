import { Uuid } from '@/common/types/common.type';
import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { bigintMoney } from '../money';

export enum PaymentMethod {
  TRANSFER = 'transfer',
  CASH = 'cash',
  OTHER = 'other',
}

export enum PaymentStatus {
  PAID = 'paid',
  PENDING = 'pending',
  FAILED = 'failed',
}

/** A subscription payment recorded by hand by an admin (contract 04, D6): no payment gateway. */
@Entity('subscription_payment')
@Unique('UQ_subscription_payment_code', ['code'])
export class SubscriptionPaymentEntity extends BaseEntity {
  constructor(data?: Partial<SubscriptionPaymentEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_subscription_payment_id',
  })
  id!: Uuid;

  @Column({ type: 'varchar', length: 12 })
  code!: string;

  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'bigint', transformer: bigintMoney })
  amount!: number;

  @Column({ type: 'varchar', length: 20 })
  method!: PaymentMethod;

  @Column({ type: 'varchar', length: 20, default: PaymentStatus.PAID })
  status!: PaymentStatus;

  @Column({ name: 'period_start', type: 'date' })
  periodStart!: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd!: string;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'created_by', type: 'varchar' })
  createdBy!: string;
}
