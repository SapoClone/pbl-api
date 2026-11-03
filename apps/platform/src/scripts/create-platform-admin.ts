/**
 * Creates the first platform super admin (ADR-0022). Run once per environment, like platform's migration task:
 *
 *   PLATFORM_ADMIN_BOOTSTRAP_PASSWORD=... node dist/apps/platform/apps/platform/src/scripts/create-platform-admin.js \
 *     --email you@example.com --name "Your Name"
 *
 * It reads the database settings from the same DATABASE_* environment as the service. The password comes from the
 * environment only (never an argument, so it stays out of the process list) and is never printed.
 * Exit code: 0 created, 2 a super admin already exists (nothing changed), 1 anything else.
 */
import { parseArgs } from 'node:util';
import { createFirstSuperAdmin } from '../api/platform-admin/create-first-super-admin';
import { AppDataSource } from '../database/data-source';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
    },
  });
  const password = process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD;
  if (!values.email || !values.name || !password) {
    console.error(
      'Usage: PLATFORM_ADMIN_BOOTSTRAP_PASSWORD=... create-platform-admin --email <email> --name <name>',
    );
    return 1;
  }

  await AppDataSource.initialize();
  try {
    const result = await createFirstSuperAdmin(AppDataSource, {
      email: values.email,
      name: values.name,
      password,
    });
    if (result.status === 'exists') {
      console.error('A platform super admin already exists; nothing changed.');
      return 2;
    }
    console.log(
      `Created the platform super admin ${values.email.trim().toLowerCase()} (${result.id}).`,
    );
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
