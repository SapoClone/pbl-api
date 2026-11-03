import { Uuid } from '@/common/types/common.type';
import { AbstractEntity } from '@/database/entities/abstract.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum TenantStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

/** A store (ADR-0008). */
@Entity('tenant')
export class TenantEntity extends AbstractEntity {
  constructor(data?: Partial<TenantEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_tenant_id' })
  id!: Uuid;

  /** Readable platform-wide code (TN0001, ...), set when the store is created and never reused */
  @Column({ type: 'varchar', length: 20 })
  @Index('UQ_tenant_code', { unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 30 })
  @Index('UQ_tenant_subdomain', { where: '"deleted_at" IS NULL', unique: true })
  subdomain!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 20, default: TenantStatus.ACTIVE })
  status!: TenantStatus;

  /** Why a platform admin suspended the store; null while it is active */
  @Column({
    name: 'suspended_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  suspendedReason!: string | null;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt!: Date | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', default: null })
  deletedAt: Date;
}
