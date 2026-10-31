import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext, TenantScopedRepository } from '@pbl/common';
import { qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  SelectQueryBuilder,
} from 'typeorm';
import { nextCode, SEQUENCE } from '../common/code-sequence';
import {
  CustomerErrorCode,
  isUniqueViolation,
  Page,
  toPage,
} from '../common/errors';
import { maskPhone } from '../common/phone';
import {
  CustomerAddressEntity,
  CustomerEntity,
  CustomerGroupEntity,
  CustomerTagEntity,
  CustomerTagLinkEntity,
  LoyaltyTransactionEntity,
} from '../entities/customer.entities';
import { ensureDefaultGroups } from '../groups/groups.service';
import {
  AddressReqDto,
  CreateCustomerReqDto,
  CustomerFiltersDto,
  CustomerSummaryReqDto,
  ListCustomersReqDto,
  UpdateAddressReqDto,
  UpdateCustomerReqDto,
} from './dto/customer.dto';

export const EXPORT_LIMIT = 10_000;

export interface CustomerListItemRes {
  id: string;
  code: string;
  name: string;
  /** null unless the caller may see phones (owner, manager) */
  phone: string | null;
  phoneMasked: string;
  email: string | null;
  status: string;
  group: { id: string; code: string; name: string } | null;
  orderCount: number;
  totalSpent: number;
  loyaltyPoints: number;
  lastPurchaseAt: string | null;
  createdAt: string;
}

export interface AddressRes {
  id: string;
  recipientName: string;
  recipientPhone: string;
  addressLine: string;
  ward: string;
  district: string;
  province: string;
  isDefault: boolean;
}

export interface CustomerDetailRes extends CustomerListItemRes {
  dob: string | null;
  gender: string | null;
  addresses: AddressRes[];
  tags: { id: string; name: string }[];
  source: string;
  note: string | null;
  memberCode: string | null;
  /** Membership tiers are not built yet */
  tier: null;
  joinedAt: string;
  /** Debt is finance's data; not available yet */
  currentDebt: null;
  debtLimit: null;
}

export interface CustomerSummaryRes {
  total: number;
  newThisMonth: number;
  members: number;
  vip: number;
  /** Needs orders per month, which only sales has */
  returningRate: null;
  returningRateDelta: null;
  groupCounts: Record<string, number>;
}

const toAddress = (a: CustomerAddressEntity): AddressRes => ({
  id: a.id,
  recipientName: a.recipientName,
  recipientPhone: a.phone,
  addressLine: a.addressLine,
  ward: a.ward,
  district: a.district,
  province: a.province,
  isDefault: a.isDefault,
});

/** The store's calendar month of `now` as `YYYY-MM` (Asia/Ho_Chi_Minh, UTC+7, no DST) */
export function currentMonth(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 7);
}

/** `[start, end)` instants of a `YYYY-MM` month in Asia/Ho_Chi_Minh */
export function monthRange(month: string): [Date, Date] {
  const [year, mon] = month.split('-').map(Number);
  const start = Date.UTC(year, mon - 1, 1) - 7 * 3_600_000;
  const end = Date.UTC(year, mon, 1) - 7 * 3_600_000;
  return [new Date(start), new Date(end)];
}

const csvCell = (value: string | number | null): string => {
  let text = value === null ? '' : String(value);
  // a cell that starts like a formula would run in a spreadsheet
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

@Injectable()
export class CustomersService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private repo<T extends { tenantId: string }>(
    entity: new () => T,
    em: EntityManager = this.dataSource.manager,
  ) {
    return TenantScopedRepository.forEntity(em, entity);
  }

  // ---- list, summary, export

  async list(
    query: ListCustomersReqDto,
    canSeePhone: boolean,
  ): Promise<Page<CustomerListItemRes>> {
    const tenantId = TenantContext.require();
    await ensureDefaultGroups(this.dataSource.manager, tenantId);
    const qb = this.filtered(query)
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    this.sorted(qb, query);
    const [rows, total] = await qb.getManyAndCount();
    const items = await this.toListItems(rows, canSeePhone);
    return toPage(items, total, query.page, query.limit);
  }

  async summary(query: CustomerSummaryReqDto): Promise<CustomerSummaryRes> {
    const tenantId = TenantContext.require();
    await ensureDefaultGroups(this.dataSource.manager, tenantId);
    const [from, to] = monthRange(query.month ?? currentMonth());
    const customers = this.repo(CustomerEntity);
    const total = await customers.count();
    const newThisMonth = await customers
      .createQueryBuilder('c')
      .where('c.createdAt >= :from AND c.createdAt < :to', { from, to })
      .getCount();
    const rows: { code: string; count: string }[] = await this.repo(
      CustomerGroupEntity,
    )
      .createQueryBuilder('g')
      .leftJoin(
        CustomerEntity,
        'c',
        'c.group_id = g.id AND c.tenant_id = g.tenant_id AND c.deleted_at IS NULL',
      )
      .select('g.code', 'code')
      .addSelect('count(c.id)', 'count')
      .groupBy('g.id')
      .getRawMany();
    const groupCounts: Record<string, number> = { all: total };
    for (const row of rows) groupCounts[row.code] = Number(row.count);
    return {
      total,
      newThisMonth,
      members: groupCounts['member'] ?? 0,
      vip: groupCounts['vip'] ?? 0,
      returningRate: null,
      returningRateDelta: null,
      groupCounts,
    };
  }

  /** A UTF-8 CSV (with a BOM, so Excel reads Vietnamese) of the filtered customers */
  async exportCsv(
    filters: CustomerFiltersDto,
    canSeePhone: boolean,
  ): Promise<string> {
    await ensureDefaultGroups(this.dataSource.manager, TenantContext.require());
    const qb = this.filtered(filters).take(EXPORT_LIMIT);
    this.sorted(qb, filters);
    const rows = await qb.getMany();
    const items = await this.toListItems(rows, canSeePhone);
    const header = [
      'code',
      'name',
      'phone',
      'email',
      'group',
      'status',
      'orderCount',
      'totalSpent',
      'loyaltyPoints',
      'lastPurchaseAt',
      'createdAt',
    ];
    const lines = items.map((c) =>
      [
        c.code,
        c.name,
        c.phone ?? c.phoneMasked,
        c.email,
        c.group?.name ?? null,
        c.status,
        c.orderCount,
        c.totalSpent,
        c.loyaltyPoints,
        c.lastPurchaseAt,
        c.createdAt,
      ]
        .map(csvCell)
        .join(','),
    );
    const bom = String.fromCharCode(0xfeff);
    return `${bom}${[header.join(','), ...lines].join('\r\n')}\r\n`;
  }

  private filtered(f: CustomerFiltersDto): SelectQueryBuilder<CustomerEntity> {
    const qb = this.repo(CustomerEntity).createQueryBuilder('c');
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('c.name ILIKE :like', { like })
            .orWhere('c.phone ILIKE :like')
            .orWhere('c.email ILIKE :like')
            .orWhere('c.code ILIKE :like')
            .orWhere('c.memberCode ILIKE :like'),
        ),
      );
    }
    if (f.groupCode?.length) {
      const groupTable = qualifiedTable(this.dataSource, 'customer_group');
      qb.andWhere(
        `c.group_id IN (SELECT g.id FROM ${groupTable} g WHERE g.tenant_id = c.tenant_id AND g.code IN (:...groupCodes))`,
        { groupCodes: f.groupCode },
      );
    }
    if (f.tagId) {
      const linkTable = qualifiedTable(this.dataSource, 'customer_tag_link');
      qb.andWhere(
        `EXISTS (SELECT 1 FROM ${linkTable} l WHERE l.customer_id = c.id AND l.tag_id = :tagId AND l.tenant_id = c.tenant_id)`,
        { tagId: f.tagId },
      );
    }
    if (f.status) qb.andWhere('c.status = :status', { status: f.status });
    if (f.spendMin !== undefined) {
      qb.andWhere('c.totalSpent >= :spendMin', { spendMin: f.spendMin });
    }
    if (f.spendMax !== undefined) {
      qb.andWhere('c.totalSpent <= :spendMax', { spendMax: f.spendMax });
    }
    return qb;
  }

  private sorted(
    qb: SelectQueryBuilder<CustomerEntity>,
    f: CustomerFiltersDto,
  ) {
    qb.orderBy(`c.${f.sort}`, f.order, 'NULLS LAST').addOrderBy('c.id', 'ASC');
  }

  // ---- one customer

  async create(
    dto: CreateCustomerReqDto,
    canSeePhone: boolean,
  ): Promise<CustomerDetailRes> {
    const tenantId = TenantContext.require();
    const defaults = (dto.addresses ?? []).filter((a) => a.isDefault).length;
    if (defaults > 1)
      throw this.invalidAddress('Only one address can be the default');

    let id: string;
    try {
      id = await this.dataSource.transaction(async (em) => {
        await ensureDefaultGroups(em, tenantId);
        const groupId = await this.resolveGroup(em, dto.groupId, 'retail');
        const tagIds = await this.resolveTags(em, dto.tagIds);
        await this.assertPhoneFree(em, dto.phone);

        const customerId = randomUUID();
        const code = await nextCode(em, tenantId, SEQUENCE.CUSTOMER);
        const memberCode = dto.loyalty?.enabled
          ? await nextCode(em, tenantId, SEQUENCE.MEMBER)
          : null;
        const initialPoints = dto.loyalty?.enabled
          ? (dto.loyalty.initialPoints ?? 0)
          : 0;
        await this.repo(CustomerEntity, em).save({
          id: customerId,
          code,
          memberCode,
          groupId,
          name: dto.name,
          phone: dto.phone,
          email: dto.email ?? null,
          gender: dto.gender ?? null,
          dob: dto.dob ?? null,
          source: dto.source ?? 'store',
          note: dto.note ?? null,
          status: 'active',
          orderCount: 0,
          totalSpent: 0,
          lastPurchaseAt: null,
          pointsBalance: initialPoints,
        });
        await this.linkTags(em, customerId, tagIds);
        const addresses = dto.addresses ?? [];
        for (const [index, a] of addresses.entries()) {
          await this.insertAddress(
            em,
            customerId,
            a,
            defaults === 0 ? index === 0 : !!a.isDefault,
          );
        }
        if (initialPoints > 0) {
          await this.repo(LoyaltyTransactionEntity, em).save({
            id: randomUUID(),
            customerId,
            type: 'adjust',
            points: initialPoints,
            balanceAfter: initialPoints,
            refType: null,
            refId: null,
            refCode: null,
            note: 'Initial points',
          });
        }
        return customerId;
      });
    } catch (error) {
      throw await this.mapPhoneConflict(error, dto.phone);
    }
    return this.detail(id, canSeePhone);
  }

  async get(id: string, canSeePhone: boolean): Promise<CustomerDetailRes> {
    return this.detail(id, canSeePhone);
  }

  async update(
    id: string,
    dto: UpdateCustomerReqDto,
    canSeePhone: boolean,
  ): Promise<CustomerDetailRes> {
    const tenantId = TenantContext.require();
    try {
      await this.dataSource.transaction(async (em) => {
        const customers = this.repo(CustomerEntity, em);
        const customer = await customers.findOneBy({ id });
        if (!customer) throw new NotFoundException();
        const patch: Partial<CustomerEntity> = { updatedAt: new Date() };
        // null clears an optional field; a required one ignores it
        if (dto.name) patch.name = dto.name;
        if (dto.status) patch.status = dto.status;
        if (dto.phone && dto.phone !== customer.phone) {
          await this.assertPhoneFree(em, dto.phone, id);
          patch.phone = dto.phone;
        }
        if (dto.email !== undefined) patch.email = dto.email ?? null;
        if (dto.dob !== undefined) patch.dob = dto.dob ?? null;
        if (dto.gender !== undefined) patch.gender = dto.gender ?? null;
        if (dto.source) patch.source = dto.source;
        if (dto.note !== undefined) patch.note = dto.note ?? null;
        if (dto.groupId) {
          await ensureDefaultGroups(em, tenantId);
          patch.groupId = await this.resolveGroup(em, dto.groupId, 'retail');
        }
        if (dto.loyalty?.enabled && !customer.memberCode) {
          patch.memberCode = await nextCode(em, tenantId, SEQUENCE.MEMBER);
        }
        await customers.update({ id }, patch);
        if (dto.tagIds !== undefined) {
          const tagIds = await this.resolveTags(em, dto.tagIds);
          await this.repo(CustomerTagLinkEntity, em).delete({ customerId: id });
          await this.linkTags(em, id, tagIds);
        }
      });
    } catch (error) {
      throw await this.mapPhoneConflict(error, dto.phone);
    }
    return this.detail(id, canSeePhone);
  }

  async remove(id: string): Promise<void> {
    const result = await this.repo(CustomerEntity).softDelete({ id });
    if (!result.affected) throw new NotFoundException();
  }

  // ---- addresses

  async addAddress(
    customerId: string,
    dto: AddressReqDto,
    canSeePhone: boolean,
  ): Promise<CustomerDetailRes> {
    await this.dataSource.transaction(async (em) => {
      await this.lockCustomer(em, customerId);
      const count = await this.repo(CustomerAddressEntity, em).count({
        where: { customerId },
      });
      // the first address is the default; a later one only when asked
      const isDefault = count === 0 || !!dto.isDefault;
      if (isDefault) await this.clearDefault(em, customerId);
      await this.insertAddress(em, customerId, dto, isDefault);
    });
    return this.detail(customerId, canSeePhone);
  }

  async updateAddress(
    customerId: string,
    addressId: string,
    dto: UpdateAddressReqDto,
    canSeePhone: boolean,
  ): Promise<CustomerDetailRes> {
    await this.dataSource.transaction(async (em) => {
      await this.lockCustomer(em, customerId);
      const addresses = this.repo(CustomerAddressEntity, em);
      const address = await addresses.findOneBy({ id: addressId, customerId });
      if (!address) throw new NotFoundException();
      const patch: Partial<CustomerAddressEntity> = {};
      if (dto.recipientName) patch.recipientName = dto.recipientName;
      if (dto.recipientPhone) patch.phone = dto.recipientPhone;
      if (dto.addressLine) patch.addressLine = dto.addressLine;
      if (dto.ward) patch.ward = dto.ward;
      if (dto.district) patch.district = dto.district;
      if (dto.province) patch.province = dto.province;
      if (dto.isDefault === true && !address.isDefault) {
        await this.clearDefault(em, customerId);
        patch.isDefault = true;
      } else if (dto.isDefault === false && address.isDefault) {
        // there is always a default while there is an address
        throw this.invalidAddress(
          'Make another address the default instead of removing the flag',
        );
      }
      if (Object.keys(patch).length > 0)
        await addresses.update({ id: addressId }, patch);
    });
    return this.detail(customerId, canSeePhone);
  }

  async removeAddress(customerId: string, addressId: string): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await this.lockCustomer(em, customerId);
      const addresses = this.repo(CustomerAddressEntity, em);
      const address = await addresses.findOneBy({ id: addressId, customerId });
      if (!address) throw new NotFoundException();
      await addresses.delete({ id: addressId });
      if (address.isDefault) {
        // the oldest remaining address takes over
        const next = await addresses.find({
          where: { customerId },
          order: { createdAt: 'ASC', id: 'ASC' },
          take: 1,
        });
        if (next[0])
          await addresses.update({ id: next[0].id }, { isDefault: true });
      }
    });
  }

  // ---- helpers

  /** The customer row, locked for the transaction: serialises the address edits of one customer */
  private async lockCustomer(
    em: EntityManager,
    customerId: string,
  ): Promise<void> {
    const found = await this.repo(CustomerEntity, em)
      .createQueryBuilder('c')
      .where('c.id = :customerId', { customerId })
      .setLock('pessimistic_write')
      .getOne();
    if (!found) throw new NotFoundException();
  }

  private async clearDefault(
    em: EntityManager,
    customerId: string,
  ): Promise<void> {
    await this.repo(CustomerAddressEntity, em).update(
      { customerId, isDefault: true },
      { isDefault: false },
    );
  }

  private async insertAddress(
    em: EntityManager,
    customerId: string,
    a: AddressReqDto,
    isDefault: boolean,
  ): Promise<void> {
    await this.repo(CustomerAddressEntity, em).save({
      id: randomUUID(),
      customerId,
      recipientName: a.recipientName,
      phone: a.recipientPhone,
      addressLine: a.addressLine,
      ward: a.ward,
      district: a.district,
      province: a.province,
      isDefault,
    });
  }

  private async linkTags(
    em: EntityManager,
    customerId: string,
    tagIds: string[],
  ) {
    if (tagIds.length === 0) return;
    await this.repo(CustomerTagLinkEntity, em).save(
      tagIds.map((tagId) => ({ customerId, tagId })),
    );
  }

  /** A group id must be this store's; no id means the default group `fallbackCode` */
  private async resolveGroup(
    em: EntityManager,
    groupId: string | undefined,
    fallbackCode: string,
  ): Promise<string> {
    const groups = this.repo(CustomerGroupEntity, em);
    const group = await groups.findOneBy(
      groupId ? { id: groupId } : { code: fallbackCode },
    );
    if (!group) {
      throw new BadRequestException({
        errorCode: CustomerErrorCode.UNKNOWN_REFERENCE,
        message: 'The group does not exist in this store',
      });
    }
    return group.id;
  }

  private async resolveTags(
    em: EntityManager,
    tagIds: string[] | undefined,
  ): Promise<string[]> {
    const unique = [...new Set(tagIds ?? [])];
    if (unique.length === 0) return [];
    const found = await this.repo(CustomerTagEntity, em).count({
      where: { id: In(unique) },
    });
    if (found !== unique.length) {
      throw new BadRequestException({
        errorCode: CustomerErrorCode.UNKNOWN_REFERENCE,
        message: 'A tag does not exist in this store',
      });
    }
    return unique;
  }

  private async assertPhoneFree(
    em: EntityManager,
    phone: string,
    exceptId?: string,
  ) {
    const other = await this.repo(CustomerEntity, em).findOneBy({ phone });
    if (other && other.id !== exceptId) throw this.phoneTaken(other.id);
  }

  private phoneTaken(existingCustomerId: string) {
    return new ConflictException({
      errorCode: CustomerErrorCode.PHONE_TAKEN,
      message: 'A customer with this phone already exists',
      // the filter copies only a list, so the id travels as a one-item list
      details: [{ existingCustomerId }],
    });
  }

  /** Two requests racing on one phone: the loser meets the unique index */
  private async mapPhoneConflict(error: unknown, phone: string | undefined) {
    if (phone && isUniqueViolation(error, 'UQ_customer_tenant_phone')) {
      const other = await this.repo(CustomerEntity).findOneBy({ phone });
      if (other) return this.phoneTaken(other.id);
    }
    return error;
  }

  private invalidAddress(message: string) {
    return new BadRequestException({
      errorCode: CustomerErrorCode.INVALID_ADDRESS,
      message,
    });
  }

  private async detail(
    id: string,
    canSeePhone: boolean,
  ): Promise<CustomerDetailRes> {
    const customer = await this.repo(CustomerEntity).findOneBy({ id });
    if (!customer) throw new NotFoundException();
    const [item] = await this.toListItems([customer], canSeePhone);
    const addresses = await this.repo(CustomerAddressEntity).find({
      where: { customerId: id },
      order: { isDefault: 'DESC', createdAt: 'ASC', id: 'ASC' },
    });
    const tags = (await this.tagsOf([id])).get(id) ?? [];
    return {
      ...item,
      dob: customer.dob,
      gender: customer.gender,
      addresses: addresses.map(toAddress),
      tags,
      source: customer.source,
      note: customer.note,
      memberCode: customer.memberCode,
      tier: null,
      joinedAt: customer.createdAt.toISOString(),
      currentDebt: null,
      debtLimit: null,
    };
  }

  private async tagsOf(customerIds: string[]) {
    const map = new Map<string, { id: string; name: string }[]>();
    if (customerIds.length === 0) return map;
    const rows: { customer_id: string; id: string; name: string }[] =
      await this.repo(CustomerTagLinkEntity)
        .createQueryBuilder('l')
        .innerJoin(
          CustomerTagEntity,
          't',
          't.id = l.tag_id AND t.tenant_id = l.tenant_id',
        )
        .where('l.customer_id IN (:...customerIds)', { customerIds })
        .select([
          'l.customer_id AS customer_id',
          't.id AS id',
          't.name AS name',
        ])
        .orderBy('t.name', 'ASC')
        .getRawMany();
    for (const row of rows) {
      const list = map.get(row.customer_id) ?? [];
      list.push({ id: row.id, name: row.name });
      map.set(row.customer_id, list);
    }
    return map;
  }

  private async toListItems(
    rows: CustomerEntity[],
    canSeePhone: boolean,
  ): Promise<CustomerListItemRes[]> {
    const groupIds = [
      ...new Set(rows.map((r) => r.groupId).filter((g): g is string => !!g)),
    ];
    const groups = groupIds.length
      ? await this.repo(CustomerGroupEntity).find({
          where: { id: In(groupIds) },
        })
      : [];
    const byId = new Map(groups.map((g) => [g.id, g]));
    return rows.map((c) => {
      const group = c.groupId ? byId.get(c.groupId) : undefined;
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        phone: canSeePhone ? c.phone : null,
        phoneMasked: maskPhone(c.phone),
        email: c.email,
        status: c.status,
        group: group
          ? { id: group.id, code: group.code, name: group.name }
          : null,
        orderCount: c.orderCount,
        totalSpent: c.totalSpent,
        loyaltyPoints: c.pointsBalance,
        lastPurchaseAt: c.lastPurchaseAt
          ? c.lastPurchaseAt.toISOString()
          : null,
        createdAt: c.createdAt.toISOString(),
      };
    });
  }
}
