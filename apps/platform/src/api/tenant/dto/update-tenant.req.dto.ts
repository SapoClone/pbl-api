import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateTenantReqDto } from './create-tenant.req.dto';

/** The subdomain cannot change. */
export class UpdateTenantReqDto extends PartialType(
  OmitType(CreateTenantReqDto, ['subdomain'] as const),
) {}
