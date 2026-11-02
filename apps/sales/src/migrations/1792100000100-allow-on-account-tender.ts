import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ON_ACCOUNT (credit sale authorised by finance) joins the allowed tender methods. The baseline
 * migration has already run in deployed databases, so the check is replaced here instead.
 */
export class AllowOnAccountTender1792100000100 implements MigrationInterface {
  name = 'AllowOnAccountTender1792100000100';

  private async setMethods(
    queryRunner: QueryRunner,
    methods: string[],
  ): Promise<void> {
    const tenders = qualifiedTable(queryRunner, 'order_tenders');
    const list = methods.map((m) => `'${m}'`).join(', ');
    await queryRunner.query(
      `ALTER TABLE ${tenders} DROP CONSTRAINT IF EXISTS "CHK_order_tenders_method"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${tenders} ADD CONSTRAINT "CHK_order_tenders_method" CHECK ("method" IN (${list}))`,
    );
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.setMethods(queryRunner, [
      'CASH',
      'BANK_TRANSFER',
      'CARD',
      'E_WALLET',
      'COD',
      'MARKETPLACE',
      'ON_ACCOUNT',
    ]);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await this.setMethods(queryRunner, [
      'CASH',
      'BANK_TRANSFER',
      'CARD',
      'E_WALLET',
      'COD',
      'MARKETPLACE',
    ]);
  }
}
