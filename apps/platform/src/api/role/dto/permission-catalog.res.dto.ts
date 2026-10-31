import {
  BooleanField,
  ClassField,
  StringField,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class PermissionModuleResDto {
  @StringField() @Expose() code: string;
  @StringField() @Expose() label: string;
  /** The actions that exist for this module */
  @StringField({ each: true }) @Expose() actions: string[];
}

@Exclude()
export class PermissionItemResDto {
  @StringField() @Expose() code: string;
  @StringField() @Expose() module: string;
  @StringField() @Expose() action: string;
  /** False for module/action pairs that do not exist (the UI shows a dash) */
  @BooleanField() @Expose() isApplicable: boolean;
}

@Exclude()
export class DefaultRoleResDto {
  @StringField() @Expose() key: string;
  @StringField() @Expose() name: string;
  @StringField({ each: true }) @Expose() permissions: string[];
}

@Exclude()
export class PermissionCatalogResDto {
  @ClassField(() => PermissionModuleResDto, { each: true, isArray: true })
  @Expose()
  modules: PermissionModuleResDto[];
  @StringField({ each: true }) @Expose() actions: string[];
  /** Every module x action pair, flagged when it exists */
  @ClassField(() => PermissionItemResDto, { each: true, isArray: true })
  @Expose()
  permissions: PermissionItemResDto[];
  /** Default permission matrix of the five seeded roles (owner lists every code) */
  @ClassField(() => DefaultRoleResDto, { each: true, isArray: true })
  @Expose()
  defaults: DefaultRoleResDto[];
}
