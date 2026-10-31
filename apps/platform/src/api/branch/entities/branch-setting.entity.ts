import { Uuid } from '@/common/types/common.type';
import { AbstractEntity } from '@/database/entities/abstract.entity';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { BranchEntity } from './branch.entity';

/** Payment methods of D5 (screen-api-contracts) */
export enum PaymentMethod {
  CASH = 'cash',
  TRANSFER = 'transfer',
  CARD = 'card',
  E_WALLET = 'e_wallet',
  COD = 'cod',
  MARKETPLACE = 'marketplace',
}

export enum InvoiceTemplateCode {
  RECEIPT_80MM = 'receipt_80mm',
  RECEIPT_58MM = 'receipt_58mm',
}

export const BRANCH_SETTING_DEFAULTS = {
  invoicePrefix: 'HD',
  defaultTaxRate: 0,
  allowedPaymentMethods: [
    PaymentMethod.CASH,
    PaymentMethod.TRANSFER,
    PaymentMethod.CARD,
  ],
  invoiceTemplateCode: null,
} as const;

/** 1-1 with branch; the row is created on first read (ERD BranchSetting). */
@Entity('branch_setting')
export class BranchSettingEntity extends AbstractEntity {
  constructor(data?: Partial<BranchSettingEntity>) {
    super();
    Object.assign(this, data);
  }

  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_branch_setting_id',
  })
  id!: Uuid;

  @Index('IDX_branch_setting_tenant_id')
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Index('UQ_branch_setting_branch_id', { unique: true })
  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @OneToOne(() => BranchEntity)
  @JoinColumn({
    name: 'branch_id',
    foreignKeyConstraintName: 'FK_branch_setting_branch',
  })
  branch?: Relation<BranchEntity>;

  @Column({
    name: 'invoice_prefix',
    type: 'varchar',
    length: 20,
    default: 'HD',
  })
  invoicePrefix!: string;

  @Column({
    name: 'invoice_template_code',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  invoiceTemplateCode!: InvoiceTemplateCode | null;

  /** Percent, 0-100 (numeric comes back from pg as a string) */
  @Column({
    name: 'default_tax_rate',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0,
    transformer: {
      to: (value?: number) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  defaultTaxRate!: number;

  @Column({
    name: 'allowed_payment_methods',
    type: 'text',
    array: true,
    default: '{cash,transfer,card}',
  })
  allowedPaymentMethods!: PaymentMethod[];
}
