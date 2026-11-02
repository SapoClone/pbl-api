import { SYSTEM_USER_ID } from '@/constants/app.constant';
import { PASSWORD_PATTERN } from '@/decorators/validators/is-password.decorator';
import { isEmail } from 'class-validator';
import { DataSource } from 'typeorm';
import {
  PlatformAdminEntity,
  PlatformAdminRole,
  PlatformAdminStatus,
} from './entities/platform-admin.entity';

export const MIN_ADMIN_PASSWORD_LENGTH = 12;

export type CreateFirstSuperAdminResult =
  | { status: 'created'; id: string }
  | { status: 'exists' };

/** A bad input; the message never contains the password. */
export class InvalidBootstrapInput extends Error {}

/**
 * Creates the first `super_admin` of the platform (ADR-0022), for the one-off bootstrap command. It changes nothing
 * when a super admin already exists (disabled ones count), so running it twice, or twice at once, is harmless.
 * The password is validated against what the sign-in form accepts, otherwise the admin could never sign in.
 */
export async function createFirstSuperAdmin(
  dataSource: DataSource,
  input: { email: string; name: string; password: string },
): Promise<CreateFirstSuperAdminResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!isEmail(email)) {
    throw new InvalidBootstrapInput('The email is not valid');
  }
  if (name.length < 1 || name.length > 100) {
    throw new InvalidBootstrapInput('The name must be 1 to 100 characters');
  }
  if (
    input.password.length < MIN_ADMIN_PASSWORD_LENGTH ||
    !PASSWORD_PATTERN.test(input.password)
  ) {
    throw new InvalidBootstrapInput(
      `The password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters of letters, digits and ! # $ % & * @ ^`,
    );
  }

  return dataSource.transaction(async (em) => {
    // Two runs at once: the second waits here, then sees the first one's admin
    await em.query(
      `SELECT pg_advisory_xact_lock(hashtext('platform_admin_bootstrap'))`,
    );
    const admins = em.getRepository(PlatformAdminEntity);
    if (
      await admins.exists({ where: { role: PlatformAdminRole.SUPER_ADMIN } })
    ) {
      return { status: 'exists' as const };
    }
    const admin = await admins.save(
      new PlatformAdminEntity({
        email,
        name,
        password: input.password, // hashed by the entity
        role: PlatformAdminRole.SUPER_ADMIN,
        status: PlatformAdminStatus.ACTIVE,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      }),
    );
    return { status: 'created' as const, id: admin.id };
  });
}
