import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Promotions can be edited and targeted: a description, channel types, customer groups, `updated_at`. */
export class AddPromotionTargeting1793600000000 implements MigrationInterface {
  name = 'AddPromotionTargeting1793600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ${qualifiedTable(queryRunner, 'promotions')}
        ADD COLUMN IF NOT EXISTS "description" text NULL,
        ADD COLUMN IF NOT EXISTS "channel_types" text[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS "customer_group_ids" uuid[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ${qualifiedTable(queryRunner, 'promotions')}
        DROP COLUMN IF EXISTS "updated_at",
        DROP COLUMN IF EXISTS "customer_group_ids",
        DROP COLUMN IF EXISTS "channel_types",
        DROP COLUMN IF EXISTS "description"`);
  }
}
