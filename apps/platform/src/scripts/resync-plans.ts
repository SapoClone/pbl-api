/**
 * Announces every store's current plan again (`platform.subscription.changed`, eventType `resync`) so catalog's
 * `tenant_plan_quota` (and any other projection) matches platform. Run it after a deploy that adds a consumer of plan
 * events, and once for stores created before those events existed (D7):
 *
 *   node dist/apps/platform/apps/platform/src/scripts/resync-plans.js
 *
 * It reads the database settings from the same DATABASE_* environment as the service. Safe to run any number of times:
 * it changes no subscription. The same work is `POST /platform/api/v1/admin/subscriptions/resync` (super admin).
 * Exit code: 0 done, 1 anything else.
 */
import { EventOutbox } from '@pbl/events';
import { AdminSubscriptionsService } from '../api/platform-admin/admin-subscriptions.service';
import { AppDataSource } from '../database/data-source';

async function main(): Promise<number> {
  await AppDataSource.initialize();
  try {
    const { count } = await new AdminSubscriptionsService(
      AppDataSource,
      new EventOutbox(),
    ).resync();
    console.log(`Announced the current plan of ${count} subscription(s).`);
    return 0;
  } finally {
    await AppDataSource.destroy();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
