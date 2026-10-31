import { TenantEntity } from '@/api/tenant/entities/tenant.entity';
import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A store's role (ADR-0020). `code` is stable and appears in tokens and
 * events: the five seeded roles use fixed codes, custom roles a slug of
 * their name. The permissions are in `role_permission`; the owner role has
 * none because it is always every permission.
 */
@Entity('role')
@Index('UQ_role_tenant_code', ['tenantId', 'code'], { unique: true })
export class RoleEntity extends BaseEntity {
  constructor(data?: Partial<RoleEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_role_id' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => TenantEntity)
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'FK_role_tenant',
  })
  tenant?: Relation<TenantEntity>;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @Column({ name: 'is_seeded', type: 'boolean', default: false })
  isSeeded!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
