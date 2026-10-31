import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { bigintNumber } from '../orders/entities/order.entity';

@Entity('shift')
@Index('UQ_shift_tenant_code', ['tenantId', 'code'], { unique: true })
@Index('UQ_shift_open_register', ['tenantId', 'registerId'], {
  unique: true,
  where: `"status" = 'open'`,
})
export class ShiftEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_shift_id' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** `CA00028` style, from code_sequence */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ name: 'register_id', type: 'uuid' })
  registerId!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  /** `open` or `closed` */
  @Column({ type: 'varchar', length: 10, default: 'open' })
  status!: string;

  @Column({ name: 'opened_by', type: 'uuid' })
  openedBy!: string;

  @Column({ name: 'opened_at', type: 'timestamptz', default: () => 'now()' })
  openedAt!: Date;

  @Column({
    name: 'opening_cash',
    type: 'bigint',
    default: 0,
    transformer: bigintNumber,
  })
  openingCash!: number;

  @Column({ name: 'closed_by', type: 'uuid', nullable: true })
  closedBy!: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({
    name: 'closing_cash_expected',
    type: 'bigint',
    nullable: true,
    transformer: bigintNumber,
  })
  closingCashExpected!: number | null;

  @Column({
    name: 'closing_cash_actual',
    type: 'bigint',
    nullable: true,
    transformer: bigintNumber,
  })
  closingCashActual!: number | null;

  /** actual - expected: negative is a shortfall */
  @Column({
    type: 'bigint',
    nullable: true,
    transformer: bigintNumber,
  })
  difference!: number | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;
}
