import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  InjectTenantScopedRepository,
  TenancyModule,
  getTenantScopedRepositoryToken,
} from './tenancy.module';
import { TenantContext } from './tenant-context';
import { TenantScopedRepository } from './tenant-scoped.repository';

class Widget {
  id!: string;
  tenantId!: string;
}

@Injectable()
class WidgetService {
  constructor(
    @InjectTenantScopedRepository(Widget)
    readonly widgets: TenantScopedRepository<Widget>,
  ) {}
}

describe('TenancyModule.forFeature', () => {
  it('provides a TenantScopedRepository over the entity repository', async () => {
    const repository = {
      target: Widget,
      count: jest.fn().mockResolvedValue(3),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [TenancyModule.forFeature([Widget])],
      providers: [WidgetService],
    })
      .overrideProvider(getRepositoryToken(Widget))
      .useValue(repository)
      .compile();

    const service = moduleRef.get(WidgetService);
    expect(service.widgets).toBeInstanceOf(TenantScopedRepository);
    expect(moduleRef.get(getTenantScopedRepositoryToken(Widget))).toBe(
      service.widgets,
    );

    await expect(
      TenantContext.run('t1', () => service.widgets.count()),
    ).resolves.toBe(3);
    expect(repository.count).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
    });
  });
});
