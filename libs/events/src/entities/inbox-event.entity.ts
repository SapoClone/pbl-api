import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Ids of the events a consumer has processed, so a redelivery is ignored.
 * Lives in the consumer's schema; written in the handler's transaction.
 */
@Entity('inbox_event')
export class InboxEventEntity {
  @PrimaryColumn({
    name: 'event_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_inbox_event_id',
  })
  eventId!: string;

  @Column({ type: 'varchar', length: 150 })
  type!: string;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt!: Date;
}
