import {
  BaseEntity,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Relation,
} from 'typeorm';
import { RoleEntity } from './role.entity';

/** One permission code granted by a role; the catalog is code, not a table. */
@Entity('role_permission')
export class RolePermissionEntity extends BaseEntity {
  constructor(data?: Partial<RolePermissionEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryColumn({
    name: 'role_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_role_permission',
  })
  roleId!: string;

  @PrimaryColumn({
    name: 'permission_code',
    type: 'varchar',
    length: 64,
    primaryKeyConstraintName: 'PK_role_permission',
  })
  permissionCode!: string;

  @ManyToOne(() => RoleEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'role_id',
    foreignKeyConstraintName: 'FK_role_permission_role',
  })
  role?: Relation<RoleEntity>;
}
