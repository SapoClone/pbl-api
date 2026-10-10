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

export enum AccountStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

/** A person who signs up; may own or belong to several stores (ADR-0008). */
@Entity('account')
export class AccountEntity extends AbstractEntity {
  constructor(data?: Partial<AccountEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_account_id' })
  id!: Uuid;

  @Column({ type: 'varchar' })
  @Index('UQ_account_email', { where: '"deleted_at" IS NULL', unique: true })
  email!: string;

  @Column({ type: 'varchar' })
  password!: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  name!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 20, default: AccountStatus.ACTIVE })
  status!: AccountStatus;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', default: null })
  deletedAt: Date;

  // The hash as read from the database, so saving a loaded account (e.g. a
  // profile update) doesn't hash the existing hash again.
  private loadedPassword?: string;

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
