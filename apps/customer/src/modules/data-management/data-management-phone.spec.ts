import { maskAddressPhones } from '../../domain/customer-domain';
import { ProfilesService } from '../profiles/profiles.service';
import { DataManagementService } from './data-management.service';

const PHONE = '0912345678';

/** A DataSource whose transaction hands a fake manager to the service. */
function serviceWith(em: Record<string, unknown>) {
  const dataSource = {
    options: {},
    transaction: async (cb: (m: unknown) => unknown) => cb(em),
  };
  return new DataManagementService(
    dataSource as any,
    { add: jest.fn() } as any,
  );
}

describe('responses of duplicates, merge and import carry no phone', () => {
  it('duplicates: groups hold ids, email or name only', async () => {
    const rows = [
      {
        match_type: 'EMAIL',
        match_value: 'a@b.vn',
        customer_ids: ['c1', 'c2'],
        count: '2',
      },
    ];
    const service = serviceWith({
      query: jest.fn(async (sql: string) =>
        sql.includes('set_config') ? [] : rows,
      ),
    });
    const out = await service.findDuplicates('t1');
    expect(out.total).toBe(2);
    expect(JSON.stringify(out)).not.toMatch(/phone|091/i);
  });

  it('merge (idempotent replay): history record has no phone', async () => {
    const history = {
      id: 'm1',
      sourceCustomerId: 's',
      targetCustomerId: 't',
      transferredPoints: 0,
    };
    const service = serviceWith({
      query: jest.fn(async () => []),
      getRepository: () => ({ findOne: async () => history }),
    });
    const out = await service.mergeCustomers('t1', 'u1', {
      sourceCustomerId: 's',
      targetCustomerId: 't',
    } as any);
    expect(out.idempotentReplay).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/phone|091/i);
  });

  it('import: job summary and row errors never echo the submitted phones', async () => {
    const saved: any[] = [];
    const repo = () => ({
      find: async () => [],
      findOne: async () => null,
      create: (x: unknown) => x,
      save: async (x: any) => {
        saved.push(x);
        return x;
      },
    });
    const em = {
      query: jest.fn(async (sql: string) =>
        sql.includes('customer_code_sequence') ? [{ last_value: 1 }] : [],
      ),
      connection: { options: {} },
      getRepository: repo,
    };
    const service = serviceWith(em);
    const out = await service.createImportJob('t1', 'u1', {
      rows: [
        { name: 'Ok', phone: PHONE },
        { name: 'Bad', phone: 'not-a-phone-0987654321' },
      ],
    } as any);
    expect(out.totalRows).toBe(2);
    expect(out.failedRows).toBe(1);
    expect(JSON.stringify(out)).not.toMatch(/0912345678|0987654321/);
  });
});

describe('maskAddressPhones and the embedded default address', () => {
  const address = { id: 'a', phone: PHONE, phoneNormalized: PHONE };

  it('masks unless fullPhone, and keeps null', () => {
    expect(maskAddressPhones(address, false).phone).toBe('091***5678');
    expect(maskAddressPhones(address, false).phoneNormalized).toBe(
      '091***5678',
    );
    expect(maskAddressPhones(address, true)).toBe(address);
    expect(maskAddressPhones(null, false)).toBeNull();
  });

  it('customer record masks defaultAddress phones like the profile phone', () => {
    const service = Object.create(ProfilesService.prototype) as any;
    const customer = { id: 'c', phone: PHONE, phoneNormalized: PHONE };
    const masked = service.formatCustomerRecord(customer, {
      defaultAddress: address,
    });
    expect(masked.defaultAddress.phone).toBe('091***5678');
    const full = service.formatCustomerRecord(customer, {
      fullPhone: true,
      defaultAddress: address,
    });
    expect(full.defaultAddress.phone).toBe(PHONE);
  });
});
