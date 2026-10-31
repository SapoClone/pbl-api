import { NotFoundException } from '@nestjs/common';
import { assertBranchAllowed, branchAllowed, branchFilter } from './access';

describe('branch scope helpers', () => {
  it('null allows every branch, a list only its ids', () => {
    expect(branchAllowed(null, 'b1')).toBe(true);
    expect(branchAllowed(['b1'], 'b1')).toBe(true);
    expect(branchAllowed(['b1'], 'b2')).toBe(false);
    expect(branchAllowed(['b1'], null)).toBe(false);
    expect(branchAllowed([], 'b1')).toBe(false);
  });

  it('answers 404, never 403, outside the scope', () => {
    expect(() => assertBranchAllowed(['b1'], 'b2')).toThrow(NotFoundException);
    expect(() => assertBranchAllowed(['b1'], 'b1')).not.toThrow();
    expect(() => assertBranchAllowed(null, 'b2')).not.toThrow();
  });

  it('filters a list by the scope, or by the requested allowed branch', () => {
    expect(branchFilter(null)).toBeNull();
    expect(branchFilter(['b1', 'b2'])).toEqual(['b1', 'b2']);
    expect(branchFilter(['b1', 'b2'], 'b2')).toEqual(['b2']);
    expect(branchFilter(null, 'b9')).toEqual(['b9']);
    expect(() => branchFilter(['b1'], 'b2')).toThrow(NotFoundException);
  });
});
