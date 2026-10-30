import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAttributeReqDto {
  @ApiProperty({ example: 'Color', maxLength: 80 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

export class UpdateAttributeReqDto {
  @ApiProperty({ example: 'Colour', maxLength: 80 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

export class CreateAttributeValueReqDto {
  @ApiProperty({ example: 'Black', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(120)
  value!: string;
}

export interface AttributeValueRes {
  id: string;
  attributeId: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttributeRes {
  id: string;
  name: string;
  values: AttributeValueRes[];
  createdAt: string;
  updatedAt: string;
}
