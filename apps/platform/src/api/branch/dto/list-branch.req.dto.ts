import { PageOptionsDto } from '@/common/dto/offset-pagination/page-options.dto';
import {
  BooleanFieldOptional,
  EnumFieldOptional,
} from '@/decorators/field.decorators';
import { BranchStatus } from '../entities/branch.entity';

export class ListBranchReqDto extends PageOptionsDto {
  @EnumFieldOptional(() => BranchStatus)
  readonly status?: BranchStatus;

  @BooleanFieldOptional()
  readonly isWarehouse?: boolean;
}
