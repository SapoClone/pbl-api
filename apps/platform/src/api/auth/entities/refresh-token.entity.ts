import { Uuid } from '@/common/types/common.type';
import { AbstractEntity } from '@/database/entities/abstract.entity';
import { AccessTokenSubjectType } from '@pbl/auth';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Opaque refresh tokens (ADR-0004 §6), from the platform ERD's RefreshToken,
 * plus family_id: every token rotated out of one login shares it. family_id
 * is the access token's "sid", so logout/reuse detection can kill exactly one
 * login. Only the SHA-256 of the token is stored.
 */
@Entity('refresh_token')
export class RefreshTokenEntity extends AbstractEntity {
  constructor(data?: Partial<RefreshTokenEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_refresh_token_id',
  })
  id!: Uuid;

  @Index('IDX_refresh_token_family_id')
  @Column({ name: 'family_id', type: 'uuid' })
  familyId!: Uuid;

  @Column({ name: 'subject_type', type: 'varchar', length: 32 })
  subjectType!: AccessTokenSubjectType;

  /** Soft FK, meaning depends on subject_type (account → user.id for now) */
  @Column({ name: 'subject_id', type: 'uuid' })
  subjectId!: Uuid;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: Uuid | null;

  @Index('UQ_refresh_token_token_hash', { unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
