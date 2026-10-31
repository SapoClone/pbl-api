import {
  BooleanField,
  NumberField,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class RoleResDto {
  @StringField() @Expose() id: string;
  @StringField() @Expose() name: string;
  /** Stable code: appears in the token's `roles` claim and in events */
  @StringField() @Expose() code: string;
  /** The code of a seeded role, null for a custom role (contract field) */
  @StringFieldOptional({ nullable: true }) @Expose() key: string | null;
  @StringFieldOptional({ nullable: true })
  @Expose()
  description: string | null;
  @BooleanField() @Expose() isSeeded: boolean;
  @BooleanField() @Expose() isOwner: boolean;
  @NumberField({ int: true }) @Expose() memberCount: number;
  @NumberField({ int: true }) @Expose() permissionCount: number;
}

@Exclude()
export class RoleDetailResDto extends RoleResDto {
  /** Permission codes; the owner role lists every code of the catalog */
  @StringField({ each: true }) @Expose() permissions: string[];
}
