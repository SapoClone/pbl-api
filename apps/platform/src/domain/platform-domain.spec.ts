import {
  BranchCodeVO,
  PlatformDomainError,
  PlatformDomainErrorCode,
  SubdomainVO,
  TenantMembershipAggregate,
  assertAccountIsActive,
  assertNotLastActiveBranch,
  isBranchDeactivating,
} from './platform-domain';

describe('Platform Domain Layer (M7.5 Tactical DDD)', () => {
  describe('SubdomainVO & BranchCodeVO Value Objects', () => {
    it('normalizes and validates tenant subdomains', () => {
      const vo = SubdomainVO.create('  Sapo-Store-01 ');
      expect(vo.value).toBe('sapo-store-01');
      expect(vo.equals(SubdomainVO.create('sapo-store-01'))).toBe(true);
    });

    it('rejects malformed subdomains', () => {
      expect(() => SubdomainVO.create('-bad')).toThrow(PlatformDomainError);
      expect(() => SubdomainVO.create('a')).toThrow(PlatformDomainError);
    });

    it('normalizes and validates branch codes', () => {
      const code = BranchCodeVO.create(' cn_hcm-01 ');
      expect(code.value).toBe('CN_HCM-01');
      expect(code.equals(BranchCodeVO.create('CN_HCM-01'))).toBe(true);
    });

    it('rejects invalid branch codes', () => {
      expect(() => BranchCodeVO.create('')).toThrow(PlatformDomainError);
      expect(() => BranchCodeVO.create('!bad')).toThrow(PlatformDomainError);
    });
  });

  describe('AccountLifecyclePolicy', () => {
    it('allows active accounts and rejects inactive/missing accounts', () => {
      expect(() => assertAccountIsActive('active')).not.toThrow();
      expect(() => assertAccountIsActive('inactive')).toThrow(
        PlatformDomainError,
      );
      expect(() => assertAccountIsActive(null)).toThrow(PlatformDomainError);
    });
  });

  describe('TenantMembershipAggregate', () => {
    it('blocks changing the role of a tenant owner (T003 invariant)', () => {
      const ownerMembership = new TenantMembershipAggregate(
        'acc-1',
        'ten-1',
        'owner',
      );
      expect(() => ownerMembership.changeRole('manager')).toThrow(
        expect.objectContaining({
          code: PlatformDomainErrorCode.OWNER_ROLE_LOCKED,
        }),
      );
    });

    it('transitions non-owner roles and detects idempotent no-op changes', () => {
      const member = new TenantMembershipAggregate('acc-2', 'ten-1', 'cashier');
      const noop = member.changeRole('cashier');
      expect(noop).toEqual({
        changed: false,
        previousRole: 'cashier',
        newRole: 'cashier',
      });

      const changed = member.changeRole('manager');
      expect(changed).toEqual({
        changed: true,
        previousRole: 'cashier',
        newRole: 'manager',
      });
      expect(member.role).toBe('manager');
    });
  });

  describe('BranchLifecyclePolicy (B002 Last Active Branch Invariant)', () => {
    it('detects when a branch update deactivates an active branch', () => {
      expect(isBranchDeactivating('active', 'inactive')).toBe(true);
      expect(isBranchDeactivating('active', 'active')).toBe(false);
      expect(isBranchDeactivating('inactive', 'inactive')).toBe(false);
    });

    it('prevents deactivating or removing the last active branch', () => {
      expect(() => assertNotLastActiveBranch(1)).toThrow(
        expect.objectContaining({
          code: PlatformDomainErrorCode.LAST_ACTIVE_BRANCH,
        }),
      );
      expect(() => assertNotLastActiveBranch(2)).not.toThrow();
    });
  });
});
