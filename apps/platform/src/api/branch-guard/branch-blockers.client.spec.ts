import {
  BlockersUnavailableError,
  BranchBlockersClient,
} from './branch-blockers.client';

const config = {
  inventoryUrl: 'http://inv',
  salesUrl: 'http://sales',
  integrationUrl: 'http://int',
  internalToken: 'tok',
  timeoutMs: 1000,
};

describe('BranchBlockersClient', () => {
  let http: { get: jest.Mock };
  let client: BranchBlockersClient;

  beforeEach(() => {
    http = { get: jest.fn() };
    client = new BranchBlockersClient(http as never, config as never);
  });

  it('asks inventory, sales and integration in parallel as a service, with the token and tenant', async () => {
    http.get.mockImplementation(async (url: string) => ({
      data: {
        reasons: url.startsWith('http://inv')
          ? [{ code: 'A', message: 'm', count: 2 }]
          : [],
      },
    }));

    const reasons = await client.forBranch('t1', 'b1');

    expect(http.get).toHaveBeenCalledTimes(3);
    expect(http.get).toHaveBeenCalledWith(
      'http://inv/internal/v1/branches/b1/blockers',
      expect.objectContaining({ headers: { 'x-internal-token': 'tok' } }),
      { asService: true, tenantId: 't1' },
    );
    expect(http.get).toHaveBeenCalledWith(
      'http://sales/internal/v1/branches/b1/blockers',
      expect.anything(),
      expect.anything(),
    );
    expect(http.get).toHaveBeenCalledWith(
      'http://int/internal/v1/branches/b1/blockers',
      expect.anything(),
      expect.anything(),
    );
    expect(reasons).toEqual([
      { code: 'A', message: 'm', count: 2, service: 'inventory' },
    ]);
  });

  it('still asks the other services when one is slow or down, then fails closed naming it', async () => {
    http.get.mockImplementation(async (url: string) => {
      if (url.startsWith('http://sales')) throw new Error('ECONNREFUSED');
      return { data: { reasons: [] } };
    });

    const error = await client.forBranch('t1', 'b1').catch((e) => e);

    expect(http.get).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(BlockersUnavailableError);
    expect(error.service).toBe('sales');
  });

  it('treats an answer without reasons as unavailable (fail closed)', async () => {
    http.get.mockResolvedValue({ data: {} });

    await expect(client.forBranch('t1', 'b1')).rejects.toBeInstanceOf(
      BlockersUnavailableError,
    );
  });

  it('asks only sales about a member', async () => {
    http.get.mockResolvedValue({
      data: {
        reasons: [{ code: 'SALES_MEMBER_OPEN_SHIFT', message: 'm', count: 1 }],
      },
    });

    const reasons = await client.forMember('t1', 'acc1');

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get.mock.calls[0][0]).toBe(
      'http://sales/internal/v1/members/acc1/blockers',
    );
    expect(reasons[0].service).toBe('sales');
  });
});
