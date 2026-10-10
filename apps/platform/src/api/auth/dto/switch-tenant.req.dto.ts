import { UUIDField } from '@/decorators/field.decorators';

export class SwitchTenantReqDto {
  @UUIDField()
  tenantId!: string;
}
