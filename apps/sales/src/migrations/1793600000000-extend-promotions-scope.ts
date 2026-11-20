import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendPromotionsScope1793600000000 implements MigrationInterface {
  name = 'ExtendPromotionsScope1793600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const promotions = qualifiedTable(queryRunner, 'promotions');
    await queryRunner.query(`
      ALTER TABLE ${promotions}
        ADD COLUMN IF NOT EXISTS "description" character varying(500) NULL,
        ADD COLUMN IF NOT EXISTS "channel_types" text[] NOT NULL DEFAULT '{}'::text[],
        ADD COLUMN IF NOT EXISTS "customer_group_ids" uuid[] NOT NULL DEFAULT '{}'::uuid[],
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const promotions = qualifiedTable(queryRunner, 'promotions');
    await queryRunner.query(`
      ALTER TABLE ${promotions}
        DROP COLUMN IF EXISTS "updated_at",
        DROP COLUMN IF EXISTS "customer_group_ids",
        DROP COLUMN IF EXISTS "channel_types",
        DROP COLUMN IF EXISTS "description"
    `);
  }
}
