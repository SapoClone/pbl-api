import { PageOptionsDto } from '@/common/dto/offset-pagination/page-options.dto';
import { EnumFieldOptional } from '@/decorators/field.decorators';
import { BranchStatus } from '../entities/branch.entity';

export class ListBranchReqDto extends PageOptionsDto {
  @EnumFieldOptional(() => BranchStatus)
  readonly status?: BranchStatus;
}
