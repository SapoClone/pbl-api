import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { moneyTransformer } from '../../common/money';

export type CategoryStatus = 'ACTIVE' | 'INACTIVE';
export type BrandStatus = 'ACTIVE' | 'INACTIVE';
export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type VariantStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type PriceListStatus = 'ACTIVE' | 'INACTIVE';

export interface ProductImageMeta {
  key: string;
  url: string;
  altText?: string | null;
  sortOrder: number;
}

@Entity('categories')
export class CategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'normalized_name', type: 'varchar', length: 120 })
  normalizedName!: string;

  @Column({ type: 'varchar', length: 140 })
  slug!: string;

  @Column({ type: 'integer', default: 1 })
  depth!: number;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: CategoryStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('brands')
export class BrandEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'normalized_name', type: 'varchar', length: 120 })
  normalizedName!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: BrandStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('attributes')
export class AttributeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ name: 'normalized_name', type: 'varchar', length: 80 })
  normalizedName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('attribute_values')
export class AttributeValueEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'attribute_id', type: 'uuid' })
  attributeId!: string;

  @Column({ type: 'varchar', length: 120 })
  value!: string;

  @Column({ name: 'normalized_value', type: 'varchar', length: 120 })
  normalizedValue!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('products')
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  @Column({ name: 'brand_id', type: 'uuid', nullable: true })
  brandId!: string | null;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'normalized_name', type: 'varchar', length: 200 })
  normalizedName!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'base_unit', type: 'varchar', length: 40, default: 'piece' })
  baseUnit!: string;

  @Column({ name: 'is_combo', type: 'boolean', default: false })
  isCombo!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: ProductStatus;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  images!: ProductImageMeta[];

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}

/**
 * ProductVariantEntity strictly excludes `avg_cost_price`, `total_quantity_for_cost`,
 * `quantity_on_hand`, and `quantity_reserved` (owned by Inventory — ADR-0013).
 */
@Entity('product_variants')
export class ProductVariantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'sku_code', type: 'varchar', length: 64 })
  skuCode!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  barcode!: string | null;

  @Column({ type: 'varchar', length: 240 })
  name!: string;

  @Column({
    name: 'base_price',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  basePrice!: number;

  @Column({ name: 'image_url', type: 'varchar', length: 500, nullable: true })
  imageUrl!: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    nullable: true,
  })
  weight!: string | null;

  @Column({
    name: 'combination_signature',
    type: 'varchar',
    length: 512,
    default: 'DEFAULT',
  })
  combinationSignature!: string;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: VariantStatus;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}

@Entity('variant_attribute_values')
export class VariantAttributeValueEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'variant_id', type: 'uuid' })
  variantId!: string;

  @Column({ name: 'attribute_id', type: 'uuid' })
  attributeId!: string;

  @Column({ name: 'attribute_value_id', type: 'uuid' })
  attributeValueId!: string;
}

@Entity('unit_conversions')
export class UnitConversionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'unit_name', type: 'varchar', length: 60 })
  unitName!: string;

  @Column({ name: 'normalized_unit_name', type: 'varchar', length: 60 })
  normalizedUnitName!: string;

  @Column({
    name: 'conversion_factor',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  conversionFactor!: string;

  @Column({ name: 'is_base', type: 'boolean', default: false })
  isBase!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('price_lists')
export class PriceListEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'normalized_name', type: 'varchar', length: 120 })
  normalizedName!: string;

  @Column({ type: 'varchar', length: 8, default: 'VND' })
  currency!: string;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: PriceListStatus;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('price_list_items')
export class PriceListItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'price_list_id', type: 'uuid' })
  priceListId!: string;

  @Column({ name: 'variant_id', type: 'uuid' })
  variantId!: string;

  @Column({ type: 'bigint', transformer: moneyTransformer })
  price!: number;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export type UploadKind = 'IMAGE' | 'IMPORT';
export type UploadStatus = 'PENDING' | 'UPLOADED' | 'ATTACHED';

/** Metadata of a file the client uploads through the storage adapter (images, import CSVs). */
@Entity('uploads')
export class UploadEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: UploadKind;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName!: string;

  @Column({ name: 'content_type', type: 'varchar', length: 100 })
  contentType!: string;

  @Column({ name: 'declared_size', type: 'integer' })
  declaredSize!: number;

  @Column({ name: 'stored_size', type: 'integer', nullable: true })
  storedSize!: number | null;

  @Column({ name: 'storage_key', type: 'varchar', length: 255 })
  storageKey!: string;

  @Column({ name: 'public_url', type: 'varchar', length: 500, nullable: true })
  publicUrl!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status!: UploadStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export type ProductImportStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface ProductImportRowError {
  row: number;
  message: string;
}

@Entity('product_imports')
export class ProductImportEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'upload_id', type: 'uuid' })
  uploadId!: string;

  @Column({ type: 'varchar', length: 16, default: 'PROCESSING' })
  status!: ProductImportStatus;

  @Column({ name: 'created_count', type: 'integer', default: 0 })
  createdCount!: number;

  @Column({ name: 'updated_count', type: 'integer', default: 0 })
  updatedCount!: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  errors!: ProductImportRowError[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

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
  VariantAttributeValueEntity,
  UnitConversionEntity,
  PriceListEntity,
  PriceListItemEntity,
  UploadEntity,
  ProductImportEntity,
];
