import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/** bigint / numeric come back from pg as strings; money is integer VND, so a number is safe */
const numeric = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? null : Number(value),
};

@Entity('category')
@Index('IDX_category_tenant_parent', ['tenantId', 'parentId'])
export class CategoryEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_category_id' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** The tree: null for a root category */
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 180 })
  slug!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('brand')
@Index('UQ_brand_tenant_name', ['tenantId', 'name'], { unique: true })
export class BrandEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_brand_id' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('attribute')
@Index('UQ_attribute_tenant_name', ['tenantId', 'name'], { unique: true })
export class AttributeEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_attribute_id' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('attribute_value')
@Index('UQ_attribute_value_attribute_value', ['attributeId', 'value'], {
  unique: true,
})
export class AttributeValueEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_attribute_value_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'attribute_id', type: 'uuid' })
  attributeId!: string;

  @Column({ type: 'varchar', length: 100 })
  value!: string;

  /** Short code used in generated SKUs */
  @Column({ type: 'varchar', length: 30 })
  code!: string;
}

export type ProductStatus = 'active' | 'inactive';

@Entity('product')
@Index('IDX_product_tenant_category', ['tenantId', 'categoryId'])
export class ProductEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_product_id' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  @Column({ name: 'brand_id', type: 'uuid', nullable: true })
  brandId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'base_unit', type: 'varchar', length: 50 })
  baseUnit!: string;

  @Column({ name: 'is_combo', type: 'boolean', default: false })
  isCombo!: boolean;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: ProductStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt!: Date | null;
}

/** One axis value of a variant. Simplification: stored on the variant, not as VariantAttributeValue rows. */
export interface VariantAttribute {
  name: string;
  value: string;
}

@Entity('product_variant')
@Index('IDX_product_variant_product', ['productId'])
export class ProductVariantEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_product_variant_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'sku_code', type: 'varchar', length: 64 })
  skuCode!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  barcode!: string | null;

  /** Integer VND */
  @Column({ type: 'bigint', default: 0, transformer: numeric })
  price!: number;

  /** Maintained by inventory later; until then it is whatever the client sent */
  @Column({
    name: 'avg_cost_price',
    type: 'bigint',
    nullable: true,
    transformer: numeric,
  })
  avgCostPrice!: number | null;

  /** Grams */
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    nullable: true,
    transformer: numeric,
  })
  weight!: number | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: ProductStatus;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  attributes!: VariantAttribute[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt!: Date | null;
}

@Entity('product_image')
@Index('IDX_product_image_product', ['productId', 'sortOrder'])
export class ProductImageEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_product_image_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId!: string | null;

  /** Supplied by the client; there is no upload endpoint yet */
  @Column({ type: 'varchar', length: 1000 })
  url!: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_cover', type: 'boolean', default: false })
  isCover!: boolean;
}

@Entity('product_channel_listing')
@Index('UQ_product_channel_listing_variant_channel', ['variantId', 'channel'], {
  unique: true,
})
export class ProductChannelListingEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_product_channel_listing_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'variant_id', type: 'uuid' })
  variantId!: string;

  /** `pos`, `shopee`, `lazada`, `tiktok_shop`, `website`, ... (a string: sales channels are not in this schema) */
  @Column({ type: 'varchar', length: 30 })
  channel!: string;

  @Column({ name: 'is_listed', type: 'boolean', default: true })
  isListed!: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const CATALOG_ENTITIES = [
  CategoryEntity,
  BrandEntity,
  AttributeEntity,
  AttributeValueEntity,
  ProductEntity,
  ProductVariantEntity,
  ProductImageEntity,
  ProductChannelListingEntity,
];
