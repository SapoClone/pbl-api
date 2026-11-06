import { PageOptionsDto } from '@/common/dto/offset-pagination/page-options.dto';
import {
  EnumFieldOptional,
  StringFieldOptional,
} from '@/decorators/field.decorators';

export enum UsageWarningFilter {
  NORMAL = 'normal',
  NEAR_LIMIT = 'near_limit',
  AT_LIMIT = 'at_limit',
}

/** `q` searches the store's name */
export class ListAdminUsageReqDto extends PageOptionsDto {
  @StringFieldOptional({ maxLength: 30 })
  readonly planCode?: string;

  @EnumFieldOptional(() => UsageWarningFilter)
  readonly warning?: UsageWarningFilter;
}
