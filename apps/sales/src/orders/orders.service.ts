import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InjectTenantScopedRepository,
  TenantScopedRepository,
} from '@pbl/common';
import { OrderCompletedPayload, SALES_ORDER_COMPLETED } from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'crypto';
import { BranchProjectionEntity } from '../branches/branch-projection.entity';
import { CreateOrderReqDto } from './dto/create-order.req.dto';
import { ListOrdersReqDto } from './dto/list-orders.req.dto';
import { OrderRes, toOrderRes } from './dto/order.res';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderEntity } from './entities/order.entity';

/** Error codes of this service (a domain letter plus 3 digits, api-conventions §6) */
export const SalesErrorCode = {
  UNKNOWN_BRANCH: 'S001',
} as const;

export interface Page<T> {
  data: T[];
  pagination: {
    limit: number;
    currentPage: number;
    nextPage?: number;
    totalRecords: number;
    totalPages: number;
  };
}

/**
 * Sells at the counter: the order, its lines and the `sales.order.completed`
 * event commit in one transaction. Every read and write is scoped to the
 * token's store by TenantScopedRepository (ADR-0008).
 */
@Injectable()
export class OrdersService {
  constructor(
    @InjectTenantScopedRepository(OrderEntity)
    private readonly orders: TenantScopedRepository<OrderEntity>,
    @InjectTenantScopedRepository(BranchProjectionEntity)
    private readonly branches: TenantScopedRepository<BranchProjectionEntity>,
    private readonly outbox: EventOutbox,
  ) {}

  async create(accountId: string, dto: CreateOrderReqDto): Promise<OrderRes> {
    await this.assertActiveBranch(dto.branchId);

    const orderId = randomUUID();
    const items = dto.items.map((line) => {
      const item = new OrderItemEntity();
      item.id = randomUUID();
      item.orderId = orderId;
      item.sku = line.sku;
      item.name = line.name;
      item.quantity = line.quantity;
      item.unitPrice = line.unitPrice;
      item.lineTotal = line.quantity * line.unitPrice;
      return item;
    });
    const order = new OrderEntity();
    order.id = orderId;
    order.code = this.newCode();
    order.branchId = dto.branchId;
    order.status = 'completed';
    order.paymentMethod = dto.paymentMethod;
    order.customerName = dto.customerName ?? null;
    order.totalAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);
    order.itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    order.createdBy = accountId;
    order.createdAt = new Date();

    const saved = await this.orders.transaction(async (orders, em) => {
      const row = await orders.save(order);
      const lines = await TenantScopedRepository.forEntity(
        em,
        OrderItemEntity,
      ).save(items);
      await this.outbox.add(em, SALES_ORDER_COMPLETED, {
        orderId: row.id,
        code: row.code,
        branchId: row.branchId,
        totalAmount: row.totalAmount,
        itemCount: row.itemCount,
        paymentMethod: row.paymentMethod,
        createdBy: accountId,
        completedAt: new Date().toISOString(),
        items: lines.map((l) => ({
          sku: l.sku,
          name: l.name,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      } satisfies OrderCompletedPayload);
      row.items = lines;
      return row;
    });
    return toOrderRes(saved);
  }

  async list(query: ListOrdersReqDto): Promise<Page<OrderRes>> {
    const [rows, total] = await this.orders.findAndCount({
      where: query.branchId ? { branchId: query.branchId } : {},
      order: { createdAt: 'DESC' },
      take: query.limit,
      skip: (query.page - 1) * query.limit,
    });
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    return {
      data: rows.map(toOrderRes),
      pagination: {
        limit: query.limit,
        currentPage: query.page,
        ...(query.page < totalPages ? { nextPage: query.page + 1 } : {}),
        totalRecords: total,
        totalPages,
      },
    };
  }

  async get(id: string): Promise<OrderRes> {
    const order = await this.orders.findOne({
      where: { id },
      relations: { items: true },
    });
    if (!order) {
      // also another store's order: never revealed (api-conventions §6)
      throw new NotFoundException();
    }
    return toOrderRes(order);
  }

  /** A bare branch id from the request is checked against the projection, with the tenant */
  private async assertActiveBranch(branchId: string): Promise<void> {
    const branch = await this.branches.findOne({ where: { branchId } });
    if (!branch || branch.status !== 'active') {
      throw new BadRequestException({
        errorCode: SalesErrorCode.UNKNOWN_BRANCH,
        message: 'The branch does not exist in this store or is not active',
      });
    }
  }

  private newCode(): string {
    const stamp = Date.now().toString(36).toUpperCase();
    const salt = randomUUID().slice(0, 3).toUpperCase();
    return `DH-${stamp}${salt}`;
  }
}
