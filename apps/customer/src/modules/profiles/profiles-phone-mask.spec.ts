import { CustomerEntity } from '../../infrastructure/persistence/customer.entities';
import { ProfilesService } from './profiles.service';

describe('ProfilesService phone masking', () => {
  const service = Object.create(ProfilesService.prototype) as any;
  const customer = {
    id: 'c1',
    phone: '0912345678',
    phoneNormalized: '0912345678',
    email: 'a@b.vn',
  } as CustomerEntity;

  it('masks the phone unless fullPhone is explicitly true', () => {
    for (const options of [undefined, {}, { fullPhone: false }]) {
      const out = service.formatCustomerRecord(customer, options);
      expect(out.phone).toBe('091***5678');
      expect(out.phoneNormalized).toBe('091***5678');
    }
  });

  it('returns the full phone for fullPhone=true', () => {
    const out = service.formatCustomerRecord(customer, { fullPhone: true });
    expect(out.phone).toBe('0912345678');
    expect(out.phoneNormalized).toBe('0912345678');
  });
});
