import { EnumFieldOptional } from '@/decorators/field.decorators';
import { PartialType } from '@nestjs/swagger';
import { BranchStatus } from '../entities/branch.entity';
import { CreateBranchReqDto } from './create-branch.req.dto';

export class UpdateBranchReqDto extends PartialType(CreateBranchReqDto) {
  @EnumFieldOptional(() => BranchStatus)
  status?: BranchStatus;
}
