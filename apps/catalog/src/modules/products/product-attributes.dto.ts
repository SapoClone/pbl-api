import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** The most attributes one product can vary on (the variant generator caps combinations separately) */
export const MAX_PRODUCT_ATTRIBUTES = 10;

export class SetProductAttributesReqDto {
  @ApiProperty({
    type: [String],
    maxItems: MAX_PRODUCT_ATTRIBUTES,
    description:
      'The attributes this product varies on, in display order. Replaces the current list. An attribute that a variant of the product still uses cannot be left out (409).',
    example: ['0c2a6b9c-6f6c-4d3e-9a0a-2f8c9e1a7b11'],
  })
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_ATTRIBUTES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  attributeIds!: string[];
}

export class ProductAttributeValueRes {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Đỏ' })
  value!: string;

  @ApiProperty({
    description: 'How many variants of this product carry this value',
  })
  usedByVariants!: number;
}

export class ProductAttributeRes {
  @ApiProperty({ format: 'uuid' })
  attributeId!: string;

  @ApiProperty({ example: 'Màu sắc' })
  name!: string;

  @ApiProperty({ description: 'Display order, starting at 0' })
  position!: number;

  @ApiProperty({
    type: [ProductAttributeValueRes],
    description:
      'Every value of the attribute in this store (the choices a variant form offers), not only the ones this product uses',
  })
  values!: ProductAttributeValueRes[];
}

export class ProductAttributesRes {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ type: [ProductAttributeRes] })
  attributes!: ProductAttributeRes[];
}
