import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The expiry job records `past_due` in a subscription's history when a paid plan runs past its end date and enters
 * its grace (D31): the event-type check learns the value.
 */
export class AllowPastDueSubscriptionEvent1793100000400
  implements MigrationInterface
{
  name = 'AllowPastDueSubscriptionEvent1793100000400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscription_event"
        DROP CONSTRAINT "CHK_subscription_event_type",
        ADD CONSTRAINT "CHK_subscription_event_type" CHECK (
          "event_type" IN ('created', 'renewed', 'upgraded', 'downgraded', 'past_due', 'expired', 'cancelled')
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // history rows of the new kind cannot satisfy the old check
    await queryRunner.query(
      `DELETE FROM "subscription_event" WHERE "event_type" = 'past_due'`,
    );
    await queryRunner.query(`
      ALTER TABLE "subscription_event"
        DROP CONSTRAINT "CHK_subscription_event_type",
        ADD CONSTRAINT "CHK_subscription_event_type" CHECK (
          "event_type" IN ('created', 'renewed', 'upgraded', 'downgraded', 'expired', 'cancelled')
        )
    `);
  }
}
