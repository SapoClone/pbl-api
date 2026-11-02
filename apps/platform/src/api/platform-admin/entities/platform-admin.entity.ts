import { Uuid } from '@/common/types/common.type';
import { AbstractEntity } from '@/database/entities/abstract.entity';
import { hashPassword as hashPass } from '@/utils/password.util';
import {
  AfterLoad,
  BeforeInsert,
  BeforeUpdate,
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum PlatformAdminRole {
  /** May also manage admins, plans and system settings */
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
}

export enum PlatformAdminStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

/**
 * An operator of the platform (ADR-0022). Not an `Account`: it has its own credentials, signs in on the admin
 * routes only, and its tokens carry no store.
 */
@Entity('platform_admin')
export class PlatformAdminEntity extends AbstractEntity {
  constructor(data?: Partial<PlatformAdminEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_platform_admin_id',
  })
  id!: Uuid;

  /** Stored lower-case */
  @Column({ type: 'varchar' })
  @Index('UQ_platform_admin_email', {
    where: '"deleted_at" IS NULL',
    unique: true,
  })
  email!: string;

  /** Null until the admin sets one; such an admin cannot sign in */
  @Column({ type: 'varchar', nullable: true })
  password!: string | null;

  @Column({ type: 'varchar', length: 100, default: '' })
  name!: string;

  @Column({ type: 'varchar', length: 20, default: PlatformAdminRole.ADMIN })
  role!: PlatformAdminRole;

  @Column({ type: 'varchar', length: 20, default: PlatformAdminStatus.ACTIVE })
  status!: PlatformAdminStatus;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  /** Consecutive failed password logins; reset on success and when the lock starts */
  @Column({ name: 'failed_login_count', type: 'int', default: 0 })
  failedLoginCount!: number;

  /** While in the future, password logins are refused (A003) */
  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', default: null })
  deletedAt: Date;

  // The hash as read from the database, so saving a loaded admin doesn't hash the existing hash again
  // (the same guard as AccountEntity).
  private loadedPassword?: string | null;

  @AfterLoad()
  rememberLoadedPassword() {
    this.loadedPassword = this.password;
  }

  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword() {
    if (this.password && this.password !== this.loadedPassword) {
      this.password = await hashPass(this.password);
      this.loadedPassword = this.password;
    }
  }
}
