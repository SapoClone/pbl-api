import { Injectable } from '@nestjs/common';
import {
  InjectTenantRepository,
  TenantScopedRepository,
  runInTenantTransaction,
} from '@pbl/common';
import {
  CATALOG_PRICE_CHANGED,
  CatalogPriceChangedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  CatalogDomainError,
  CatalogErrorCode,
  PriceListCandidate,
  ResolvedVariantPrice,
  normalizeName,
  parseAndFormatMoney,
  resolveVariantPrice,
} from '../../domain/catalog-domain';
import {
  BranchProjectionEntity,
  PriceListBranchEntity,
  PriceListEntity,
  PriceListItemEntity,
  ProductVariantEntity,
} from '../../infrastructure/persistence/catalog.entities';
import { toCatalogHttpException } from '../../presentation/catalog-http-error';
import {
  CreatePriceListReqDto,
  PriceListItemRes,
  PriceListRes,
  ResolveVariantPriceQueryDto,
  UpdatePriceListReqDto,
  UpsertPriceListItemsReqDto,
} from './pricing.dto';

@Injectable()
export class PricingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
    @InjectTenantRepository(PriceListEntity)
    private readonly priceListRepo: TenantScopedRepository<PriceListEntity>,
  ) {}

  private validateDateWindow(
    startDate: string | null | undefined,
    endDate: string | null | undefined,
  ): void {
    if (startDate && endDate && startDate > endDate) {
      throw new CatalogDomainError(
        CatalogErrorCode.PRICE_LIST_CONFLICT,
        'Price list startDate cannot be after endDate',
        'BAD_REQUEST',
        { startDate, endDate },
      );
    }
  }

  private toPriceListItemRes(
    item: PriceListItemEntity,
    skuCode?: string,
  ): PriceListItemRes {
    return {
      id: item.id,
      priceListId: item.priceListId,
      variantId: item.variantId,
      ...(skuCode ? { skuCode } : {}),
      price: parseAndFormatMoney(item.price),
      version: item.version,
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toPriceListRes(
    entity: PriceListEntity,
    branchIds: string[],
    items?: PriceListItemRes[],
  ): PriceListRes {
    return {
      id: entity.id,
      name: entity.name,
      currency: entity.currency,
      isDefault: entity.isDefault,
      status: entity.status,
      startDate: entity.startDate,
      endDate: entity.endDate,
      version: entity.version,
      branchIds,
      ...(items ? { items } : {}),
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  /** The branches of each list (a list without rows covers every branch) */
  private async branchIdsOf(
    em: EntityManager,
    tenantId: string,
    priceListIds: string[],
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>(
      priceListIds.map((id) => [id, []]),
    );
    if (priceListIds.length === 0) return result;
    const rows = await em.getRepository(PriceListBranchEntity).find({
      where: { tenantId, priceListId: In(priceListIds) },
      order: { createdAt: 'ASC', branchId: 'ASC' },
    });
    for (const row of rows) result.get(row.priceListId)?.push(row.branchId);
    return result;
  }

  /** Every named branch must be an active branch of this store (as platform told us) */
  private async assertBranchesKnown(
    em: EntityManager,
    tenantId: string,
    branchIds: string[],
  ): Promise<void> {
    if (branchIds.length === 0) return;
    const known = await em.getRepository(BranchProjectionEntity).find({
      where: { tenantId, branchId: In(branchIds), status: 'active' },
    });
    const knownIds = new Set(known.map((b) => b.branchId));
    const missing = branchIds.filter((id) => !knownIds.has(id));
    if (missing.length > 0) {
      throw new CatalogDomainError(
        CatalogErrorCode.BRANCH_NOT_FOUND,
        `Branch ${missing[0]} was not found or is not active in this store`,
        'NOT_FOUND',
        { branchIds: missing },
      );
    }
  }

  /** A list is either the default for every branch or limited to some, never both */
  private assertScopeAllowed(isDefault: boolean, branchIds: string[]): void {
    if (isDefault && branchIds.length > 0) {
      throw new CatalogDomainError(
        CatalogErrorCode.PRICE_LIST_BRANCH_CONFLICT,
        'The default price list applies to every branch and cannot be limited to branches',
        'CONFLICT',
        { branchIds },
      );
    }
  }

  /** Makes the branch rows of the list equal to `branchIds`, and keeps their `is_active` equal to the list status */
  private async writeBranches(
    em: EntityManager,
    tenantId: string,
    list: PriceListEntity,
    branchIds: string[],
  ): Promise<void> {
    const repo = em.getRepository(PriceListBranchEntity);
    const current = await repo.find({
      where: { tenantId, priceListId: list.id },
    });
    const wanted = new Set(branchIds);
    const removed = current.filter((row) => !wanted.has(row.branchId));
    if (removed.length > 0) await repo.remove(removed);
    const isActive = list.status === 'ACTIVE';
    for (const row of current.filter((r) => wanted.has(r.branchId))) {
      if (row.isActive !== isActive) {
        row.isActive = isActive;
        await repo.save(row);
      }
    }
    const have = new Set(current.map((row) => row.branchId));
    const added = branchIds.filter((id) => !have.has(id));
    if (added.length > 0) {
      await repo.save(
        added.map((branchId) =>
          repo.create({ tenantId, priceListId: list.id, branchId, isActive }),
        ),
      );
    }
  }

  private priceChangedPayload(
    list: PriceListEntity,
    branchIds: string[],
    variant: ProductVariantEntity,
    item: PriceListItemEntity,
    previousPrice: number | null,
  ): CatalogPriceChangedPayload {
    return {
      priceListId: list.id,
      priceListName: list.name,
      // a branch list is never "the default": a consumer that ignores branches then ignores it too
      isDefault: list.isDefault && branchIds.length === 0,
      currency: list.currency,
      variantId: variant.id,
      skuCode: variant.skuCode,
      price: parseAndFormatMoney(item.price),
      previousPrice,
      effectiveFrom: list.startDate,
      effectiveTo: list.endDate,
      aggregateVersion: item.version,
      updatedAt: item.updatedAt.toISOString(),
      branchIds,
      isActive: list.status === 'ACTIVE',
      priceListVersion: list.version,
    };
  }

  /**
   * Tells the consumers about every price of the list again, after something that changes where or whether the list
   * applies (its branches, status, dates or default flag). One event per item, in the same transaction.
   */
  private async emitListPrices(
    em: EntityManager,
    tenantId: string,
    list: PriceListEntity,
    branchIds: string[],
  ): Promise<void> {
    const items = await em.getRepository(PriceListItemEntity).find({
      where: { tenantId, priceListId: list.id },
      order: { createdAt: 'ASC' },
    });
    if (items.length === 0) return;
    const variants = await em.getRepository(ProductVariantEntity).find({
      where: { tenantId, id: In(items.map((i) => i.variantId)) },
    });
    const variantById = new Map(variants.map((v) => [v.id, v]));
    for (const item of items) {
      const variant = variantById.get(item.variantId);
      if (!variant) continue;
      await this.outbox.add(
        em,
        CATALOG_PRICE_CHANGED,
        this.priceChangedPayload(
          list,
          branchIds,
          variant,
          item,
          parseAndFormatMoney(item.price),
        ),
      );
    }
  }

  async createPriceList(dto: CreatePriceListReqDto): Promise<PriceListRes> {
    try {
      const normalized = normalizeName(dto.name);
      if (!normalized) {
        throw new CatalogDomainError(
          CatalogErrorCode.PRICE_LIST_CONFLICT,
          'Price list name cannot be empty',
          'BAD_REQUEST',
        );
      }

      const startDate = dto.startDate ?? null;
      const endDate = dto.endDate ?? null;
      this.validateDateWindow(startDate, endDate);

      const branchIds = dto.branchIds ?? [];
      this.assertScopeAllowed(dto.isDefault ?? false, branchIds);

      return await runInTenantTransaction(
        this.dataSource,
        async (em, tenantId) => {
          await this.assertBranchesKnown(em, tenantId, branchIds);
          const repo = em.getRepository(PriceListEntity);
          const created = repo.create({
            tenantId,
            name: dto.name.trim(),
            normalizedName: normalized,
            currency: (dto.currency ?? 'VND').trim().toUpperCase(),
            isDefault: dto.isDefault ?? false,
            status: dto.status ?? 'ACTIVE',
            startDate,
            endDate,
            version: 1,
          });
          const saved = await repo.save(created);
          await this.writeBranches(em, tenantId, saved, branchIds);
          return this.toPriceListRes(saved, branchIds, []);
        },
      );
    } catch (error) {
      throw toCatalogHttpException(error);
    }
  }

  async listPriceLists(): Promise<PriceListRes[]> {
    try {
      return await runInTenantTransaction(
        this.dataSource,
        async (em, tenantId) => {
          const lists = await em.getRepository(PriceListEntity).find({
            where: { tenantId },
            order: { isDefault: 'DESC', createdAt: 'DESC' },
          });
          const branches = await this.branchIdsOf(
            em,
            tenantId,
            lists.map((l) => l.id),
          );
          return lists.map((list) =>
            this.toPriceListRes(list, branches.get(list.id) ?? []),
          );
        },
      );
    } catch (error) {
      throw toCatalogHttpException(error);
    }
  }

  async getPriceListById(id: string): Promise<PriceListRes> {
    try {
      return await runInTenantTransaction(
        this.dataSource,
        async (em, tenantId) => {
          const list = await em
            .getRepository(PriceListEntity)
            .findOne({ where: { id, tenantId } });
          if (!list) {
            throw new CatalogDomainError(
              CatalogErrorCode.PRICE_LIST_NOT_FOUND,
              `Price list ${id} not found`,
              'NOT_FOUND',
            );
          }

          const items = await em.getRepository(PriceListItemEntity).find({
            where: { tenantId, priceListId: list.id },
            order: { createdAt: 'ASC' },
          });

          const variantIds = items.map((i) => i.variantId);
          const variants =
            variantIds.length > 0
              ? await em.getRepository(ProductVariantEntity).find({
                  where: { tenantId, id: In(variantIds) },
                })
              : [];
          const skuByVariantId = new Map<string, string>(
            variants.map((v) => [v.id, v.skuCode]),
          );

          const branchIds =
            (await this.branchIdsOf(em, tenantId, [list.id])).get(list.id) ??
            [];
          return this.toPriceListRes(
            list,
            branchIds,
            items.map((item) =>
              this.toPriceListItemRes(item, skuByVariantId.get(item.variantId)),
            ),
          );
        },
      );
    } catch (error) {
      throw toCatalogHttpException(error);
    }
  }

  async updatePriceList(
    id: string,
    dto: UpdatePriceListReqDto,
  ): Promise<PriceListRes> {
    try {
      return await runInTenantTransaction(
        this.dataSource,
        async (em, tenantId) => {
          const repo = em.getRepository(PriceListEntity);
          const list = await repo
            .createQueryBuilder('pl')
            .setLock('pessimistic_write')
            .where('pl.tenant_id = :tenantId AND pl.id = :id', {
              tenantId,
              id,
            })
            .getOne();

          if (!list) {
            throw new CatalogDomainError(
              CatalogErrorCode.PRICE_LIST_NOT_FOUND,
              `Price list ${id} not found`,
              'NOT_FOUND',
            );
          }

          if (
            dto.expectedVersion !== undefined &&
            list.version !== dto.expectedVersion
          ) {
            throw new CatalogDomainError(
              CatalogErrorCode.RESOURCE_VERSION_CONFLICT,
              `Price list version conflict: expected ${dto.expectedVersion}, actual ${list.version}`,
              'CONFLICT',
              {
                expectedVersion: dto.expectedVersion,
                actualVersion: list.version,
              },
            );
          }

          const currentBranchIds =
            (await this.branchIdsOf(em, tenantId, [list.id])).get(list.id) ??
            [];
          const nextBranchIds = dto.branchIds ?? currentBranchIds;
          const scopeBefore = JSON.stringify([
            list.isDefault,
            list.status,
            list.startDate,
            list.endDate,
            [...currentBranchIds].sort(),
          ]);

          if (dto.name !== undefined) {
            const normalized = normalizeName(dto.name);
            if (!normalized) {
              throw new CatalogDomainError(
                CatalogErrorCode.PRICE_LIST_CONFLICT,
                'Price list name cannot be empty',
                'BAD_REQUEST',
              );
            }
            list.name = dto.name.trim();
            list.normalizedName = normalized;
          }

          if (dto.currency !== undefined) {
            list.currency = dto.currency.trim().toUpperCase();
          }
          if (dto.status !== undefined) {
            list.status = dto.status;
          }
          if (dto.startDate !== undefined) {
            list.startDate = dto.startDate;
          }
          if (dto.endDate !== undefined) {
            list.endDate = dto.endDate;
          }
          this.validateDateWindow(list.startDate, list.endDate);

          this.assertScopeAllowed(
            dto.isDefault ?? list.isDefault,
            nextBranchIds,
          );
          if (dto.branchIds !== undefined) {
            const added = nextBranchIds.filter(
              (id) => !currentBranchIds.includes(id),
            );
            await this.assertBranchesKnown(em, tenantId, added);
          }

          if (dto.isDefault !== undefined) {
            if (dto.isDefault && list.status === 'ACTIVE') {
              await em.query(
                `UPDATE price_lists
                 SET is_default = false, version = version + 1, updated_at = now()
                 WHERE tenant_id = $1 AND is_default = true AND id <> $2`,
                [tenantId, list.id],
              );
            }
            list.isDefault = dto.isDefault;
          }

          list.version += 1;
          const saved = await repo.save(list);
          await this.writeBranches(em, tenantId, saved, nextBranchIds);
          const scopeAfter = JSON.stringify([
            saved.isDefault,
            saved.status,
            saved.startDate,
            saved.endDate,
            [...nextBranchIds].sort(),
          ]);
          if (scopeAfter !== scopeBefore) {
            await this.emitListPrices(em, tenantId, saved, nextBranchIds);
          }
          return this.toPriceListRes(saved, nextBranchIds);
        },
      );
    } catch (error) {
      throw toCatalogHttpException(error);
    }
  }

  async upsertPriceListItems(
    priceListId: string,
    dto: UpsertPriceListItemsReqDto,
  ): Promise<PriceListRes> {
    try {
      const seenVariantIds = new Set<string>();
      for (const item of dto.items) {
        if (seenVariantIds.has(item.variantId)) {
          throw new CatalogDomainError(
            CatalogErrorCode.PRICE_LIST_CONFLICT,
            `Duplicate variantId ${item.variantId} in price list upsert payload`,
            'BAD_REQUEST',
          );
        }
        seenVariantIds.add(item.variantId);
      }

      return await runInTenantTransaction(
        this.dataSource,
        async (em, tenantId) => {
          const listRepo = em.getRepository(PriceListEntity);
          const itemRepo = em.getRepository(PriceListItemEntity);
          const variantRepo = em.getRepository(ProductVariantEntity);

          const list = await listRepo
            .createQueryBuilder('pl')
            .setLock('pessimistic_write')
            .where('pl.tenant_id = :tenantId AND pl.id = :priceListId', {
              tenantId,
              priceListId,
            })
            .getOne();

          if (!list) {
            throw new CatalogDomainError(
              CatalogErrorCode.PRICE_LIST_NOT_FOUND,
              `Price list ${priceListId} not found`,
              'NOT_FOUND',
            );
          }

          const variantIds = Array.from(seenVariantIds);
          const variants = await variantRepo
            .createQueryBuilder('v')
            .where('v.tenant_id = :tenantId AND v.deleted_at IS NULL', {
              tenantId,
            })
            .andWhere('v.id IN (:...variantIds)', { variantIds })
            .getMany();

          if (variants.length !== variantIds.length) {
            const foundSet = new Set(variants.map((v) => v.id));
            const missing = variantIds.find((id) => !foundSet.has(id));
            throw new CatalogDomainError(
              CatalogErrorCode.VARIANT_NOT_FOUND,
              `Variant ${missing} not found`,
              'NOT_FOUND',
            );
          }
          const variantById = new Map<string, ProductVariantEntity>(
            variants.map((v) => [v.id, v]),
          );

          // the list version goes up first: the events below carry it
          list.version += 1;
          await listRepo.save(list);
          const branchIds =
            (await this.branchIdsOf(em, tenantId, [list.id])).get(list.id) ??
            [];

          const existingItems = await itemRepo.find({
            where: {
              tenantId,
              priceListId: list.id,
              variantId: In(variantIds),
            },
          });
          const existingByVariantId = new Map<string, PriceListItemEntity>(
            existingItems.map((i) => [i.variantId, i]),
          );

          for (const input of dto.items) {
            const formattedPrice = parseAndFormatMoney(input.price);
            const existing = existingByVariantId.get(input.variantId);
            const variant = variantById.get(input.variantId)!;

            if (existing) {
              const oldPrice = parseAndFormatMoney(existing.price);
              existing.price = formattedPrice;
              existing.version += 1;
              const savedItem = await itemRepo.save(existing);

              if (oldPrice !== formattedPrice) {
                await this.outbox.add(
                  em,
                  CATALOG_PRICE_CHANGED,
                  this.priceChangedPayload(
                    list,
                    branchIds,
                    variant,
                    savedItem,
                    oldPrice,
                  ),
                );
              }
            } else {
              const created = itemRepo.create({
                tenantId,
                priceListId: list.id,
                variantId: variant.id,
                price: formattedPrice,
                version: 1,
              });
              const savedItem = await itemRepo.save(created);

              await this.outbox.add(
                em,
                CATALOG_PRICE_CHANGED,
                this.priceChangedPayload(
                  list,
                  branchIds,
                  variant,
                  savedItem,
                  null,
                ),
              );
            }
          }

          const allItems = await itemRepo.find({
            where: { tenantId, priceListId: list.id },
            order: { createdAt: 'ASC' },
          });
          const allVariantIds = allItems.map((i) => i.variantId);
          const allVariants =
            allVariantIds.length > 0
              ? await variantRepo.find({
                  where: { tenantId, id: In(allVariantIds) },
                })
              : [];
          const skuMap = new Map<string, string>(
            allVariants.map((v) => [v.id, v.skuCode]),
          );

          return this.toPriceListRes(
            list,
            branchIds,
            allItems.map((item) =>
              this.toPriceListItemRes(item, skuMap.get(item.variantId)),
            ),
          );
        },
      );
    } catch (error) {
      throw toCatalogHttpException(error);
    }
  }

  async resolvePrice(
    variantId: string,
    query: ResolveVariantPriceQueryDto,
  ): Promise<ResolvedVariantPrice> {
    try {
      const asOfDate = query.asOfDate ?? new Date().toISOString().slice(0, 10);

      return await runInTenantTransaction(
        this.dataSource,
        async (em, tenantId) => {
          const variant = await em
            .getRepository(ProductVariantEntity)
            .createQueryBuilder('v')
            .where(
              'v.tenant_id = :tenantId AND v.id = :variantId AND v.deleted_at IS NULL',
              { tenantId, variantId },
            )
            .getOne();

          if (!variant) {
            throw new CatalogDomainError(
              CatalogErrorCode.VARIANT_NOT_FOUND,
              `Variant ${variantId} not found`,
              'NOT_FOUND',
            );
          }

          const listRepo = em.getRepository(PriceListEntity);
          const itemRepo = em.getRepository(PriceListItemEntity);

          let selectedCandidate: PriceListCandidate | null = null;
          if (query.priceListId) {
            const selectedList = await listRepo.findOne({
              where: { tenantId, id: query.priceListId },
            });
            if (!selectedList) {
              throw new CatalogDomainError(
                CatalogErrorCode.PRICE_LIST_NOT_FOUND,
                `Price list ${query.priceListId} not found`,
                'NOT_FOUND',
              );
            }
            if (query.branchId) {
              const covered = await this.branchIdsOf(em, tenantId, [
                selectedList.id,
              ]);
              const branches = covered.get(selectedList.id) ?? [];
              if (branches.length > 0 && !branches.includes(query.branchId)) {
                throw new CatalogDomainError(
                  CatalogErrorCode.PRICE_LIST_NOT_FOR_BRANCH,
                  `Price list ${selectedList.id} does not apply to branch ${query.branchId}`,
                  'CONFLICT',
                  { priceListId: selectedList.id, branchId: query.branchId },
                );
              }
            }
            const selectedItem = await itemRepo.findOne({
              where: {
                tenantId,
                priceListId: selectedList.id,
                variantId: variant.id,
              },
            });
            selectedCandidate = {
              id: selectedList.id,
              name: selectedList.name,
              currency: selectedList.currency,
              isDefault: selectedList.isDefault,
              status: selectedList.status,
              startDate: selectedList.startDate,
              endDate: selectedList.endDate,
              itemPrice: selectedItem ? selectedItem.price : null,
            };
          }

          let branchCandidate: PriceListCandidate | null = null;
          if (query.branchId) {
            const link = await em.getRepository(PriceListBranchEntity).findOne({
              where: {
                tenantId,
                branchId: query.branchId,
                isActive: true,
              },
            });
            const branchList = link
              ? await listRepo.findOne({
                  where: { tenantId, id: link.priceListId },
                })
              : null;
            if (branchList) {
              const branchItem = await itemRepo.findOne({
                where: {
                  tenantId,
                  priceListId: branchList.id,
                  variantId: variant.id,
                },
              });
              branchCandidate = {
                id: branchList.id,
                name: branchList.name,
                currency: branchList.currency,
                isDefault: false,
                status: branchList.status,
                startDate: branchList.startDate,
                endDate: branchList.endDate,
                itemPrice: branchItem ? branchItem.price : null,
              };
            }
          }

          let defaultCandidate: PriceListCandidate | null = null;
          const defaultList = await listRepo.findOne({
            where: {
              tenantId,
              isDefault: true,
              status: 'ACTIVE',
            },
          });
          if (defaultList) {
            const defaultItem = await itemRepo.findOne({
              where: {
                tenantId,
                priceListId: defaultList.id,
                variantId: variant.id,
              },
            });
            defaultCandidate = {
              id: defaultList.id,
              name: defaultList.name,
              currency: defaultList.currency,
              isDefault: defaultList.isDefault,
              status: defaultList.status,
              startDate: defaultList.startDate,
              endDate: defaultList.endDate,
              itemPrice: defaultItem ? defaultItem.price : null,
            };
          }

          return resolveVariantPrice({
            variantId: variant.id,
            skuCode: variant.skuCode,
            variantStatus: variant.status,
            basePrice: variant.basePrice,
            asOfDate,
            selectedList: selectedCandidate,
            branchList: branchCandidate,
            defaultList: defaultCandidate,
          });
        },
      );
    } catch (error) {
      throw toCatalogHttpException(error);
    }
  }
}
