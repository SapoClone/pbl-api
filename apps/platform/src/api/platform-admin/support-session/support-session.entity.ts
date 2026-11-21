import { Uuid } from '@/common/types/common.type';
import { AbstractEntity } from '@/database/entities/abstract.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Who closed a session: the admin (by hand, or with the session's own token) or the expiry job */
export type SupportSessionEndedBy = 'admin' | 'expiry';

/**
 * A platform admin's read-only look into one store (ADR-0025). The token it hands out is never stored: only the
 * session (its id is the token's `sid` and `act.ssn`). `status` is derived: open and not expired = active.
 */
@Entity('support_session')
@Unique('UQ_support_session_code', ['code'])
@Index('UQ_support_session_open', ['adminId', 'tenantId'], {
  unique: true,
  where: '"ended_at" IS NULL',
})
@Index('UQ_support_session_idempotency', ['adminId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotency_key" IS NOT NULL',
})
@Index('IDX_support_session_tenant', ['tenantId', 'startedAt'])
export class SupportSessionEntity extends AbstractEntity {
  constructor(data?: Partial<SupportSessionEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_support_session_id',
  })
  id!: Uuid;

  /** SESSION-0031 */
  @Column({ type: 'varchar', length: 14 })
  code!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'admin_id', type: 'uuid' })
  adminId!: string;

  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** Null while open. For an expired session: its `expiresAt`. */
  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Column({ name: 'ended_by', type: 'varchar', length: 10, nullable: true })
  endedBy!: SupportSessionEndedBy | null;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  idempotencyKey!: string | null;
}
