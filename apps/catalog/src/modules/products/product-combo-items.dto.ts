import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** The most components one combo can have */
export const MAX_COMBO_ITEMS = 50;
/** The most units of one component in a combo */
export const MAX_COMBO_ITEM_QUANTITY = 10_000;

export class ComboItemInputDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'A live variant of this store that is not a combo itself (combos do not nest)',
  })
  @IsUUID()
  childVariantId!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_COMBO_ITEM_QUANTITY, example: 2 })
  @IsInt()
  @Min(1)
  @Max(MAX_COMBO_ITEM_QUANTITY)
  quantity!: number;
}

export class SetComboItemsReqDto {
  @ApiProperty({
    type: [ComboItemInputDto],
    minItems: 1,
    maxItems: MAX_COMBO_ITEMS,
    description:
      'The whole list of components, in display order. Replaces the current list; the same variant twice is refused.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_COMBO_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ComboItemInputDto)
  items!: ComboItemInputDto[];
}

export class ComboItemRes {
  @ApiProperty({ format: 'uuid', description: 'The component row' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  comboProductId!: string;

  @ApiProperty({ format: 'uuid' })
  childVariantId!: string;

  @ApiProperty({ format: 'uuid' })
  childProductId!: string;

  @ApiProperty({ example: 'TER-500-GRN' })
  skuCode!: string;

  @ApiProperty({ example: 'Bình giữ nhiệt Terra 500ml' })
  variantName!: string;

  @ApiProperty({ description: 'Price of one unit of the component, whole VND' })
  basePrice!: number;

  @ApiProperty({ nullable: true, type: String })
  imageUrl!: string | null;

  @ApiProperty({ minimum: 1 })
  quantity!: number;

  @ApiProperty({
    description:
      'basePrice x quantity, whole VND. The sum of the lines is what the components cost bought separately; the combo price is on the combo variant.',
  })
  lineTotal!: number;

  @ApiProperty({ description: 'Display order, starting at 0' })
  sortOrder!: number;
}
