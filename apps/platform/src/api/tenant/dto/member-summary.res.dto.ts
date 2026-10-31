import {
  ClassField,
  NumberField,
  StringField,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class OnShiftBranchResDto {
  @StringField() @Expose() branchId: string;
  @StringField() @Expose() branchName: string;
  @NumberField({ int: true }) @Expose() count: number;
}

/** KPI cards of the staff screen. */
@Exclude()
export class MemberSummaryResDto {
  @NumberField({ int: true }) @Expose() total: number;
  @NumberField({ int: true }) @Expose() active: number;
  @NumberField({ int: true }) @Expose() locked: number;
  /** Active members with a shift running now (store timezone) */
  @NumberField({ int: true }) @Expose() onShift: number;
  @ClassField(() => OnShiftBranchResDto, { each: true, isArray: true })
  @Expose()
  onShiftByBranch: OnShiftBranchResDto[];
  /** The seeded roles every store starts with (5) */
  @NumberField({ int: true }) @Expose() defaultRoleCount: number;
  /** The store name: the data scope of the list */
  @StringField() @Expose() dataScope: string;
}
