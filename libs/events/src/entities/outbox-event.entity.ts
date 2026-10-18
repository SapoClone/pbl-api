import { EventEnvelope } from '@pbl/common';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * An event waiting to be published, written in the same transaction as the
 * state change that caused it (ADR-0007). Lives in the producer's schema.
 */
@Entity('outbox_event')
@Index('IDX_outbox_event_due', ['nextAttemptAt'], {
  where: '"published_at" IS NULL AND "failed_at" IS NULL',
})
export class OutboxEventEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_outbox_event_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 150 })
  type!: string;

  @Column({ type: 'int' })
  version!: number;

  /** The whole envelope */
  @Column({ type: 'jsonb' })
  payload!: EventEnvelope;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({
    name: 'next_attempt_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  nextAttemptAt!: Date;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  /** Set after too many failed publishes; the row is kept for inspection */
  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;
}
