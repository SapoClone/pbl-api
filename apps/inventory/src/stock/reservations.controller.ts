import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public, RequireRoles } from '@pbl/auth';
import { TenantContext } from '@pbl/common';
import { ROLES, StockReservation } from '@pbl/contracts';
import type { Response } from 'express';
import { rethrowInventoryHttpError } from '../presentation/inventory-http-error';
import {
  CreateWarehouseReservationDto,
  ReleaseWarehouseReservationDto,
  ReserveStockReqDto,
} from './dto/stock.dto';
import {
  ReservationMismatchError,
  ReservationsService,
  StockShortageError,
} from './reservations.service';
import { InventoryErrorCode } from './stock.service';

const TENANT_ID_HEADER = 'x-tenant-id';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveInternalTenantId(headerTenantId?: string): string {
  const active = TenantContext.current();
  if (active && UUID_REGEX.test(active)) {
    return active;
  }
  if (headerTenantId && UUID_REGEX.test(headerTenantId.trim())) {
    return headerTenantId.trim();
  }
  throw new BadRequestException({
    errorCode: 'MISSING_TENANT_CONTEXT',
    message: 'Valid X-Tenant-Id header (UUID) is required for internal calls',
  });
}

/**
 * The command `sales` sends before it sells. Internal: it is not declared in
 * `krakend.json`, so the gateway answers 404 for it. The caller forwards the user's
 * token, so inventory verifies the user and takes the tenant from it.
 */
@ApiTags('internal')
@ApiBearerAuth()
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
@Controller('internal/reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** 201 when the stock is held, 200 for an order that was already held, 409 with the shortages otherwise */
  @Post()
  @ApiOperation({
    summary: '[Internal] Reserve branch stock for an order',
    description:
      'Idempotently holds branch stock for a sales order. Returns 201 when created, 200 on replay, or 409 on stock shortage.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Branch stock reserved for the order',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Out of stock or reservation payload mismatch',
  })
  async reserve(
    @Body() dto: ReserveStockReqDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StockReservation> {
    try {
      const { created, reservation } = await this.reservations.reserve(dto);
      res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
      return reservation;
    } catch (error) {
      if (error instanceof StockShortageError) {
        throw new ConflictException({
          errorCode: InventoryErrorCode.OUT_OF_STOCK,
          message: 'Not enough stock for this order',
          details: error.shortages,
        });
      }
      if (error instanceof ReservationMismatchError) {
        throw new ConflictException({
          errorCode: InventoryErrorCode.RESERVATION_MISMATCH,
          message: error.message,
        });
      }
      throw error;
    }
  }

  /** Gives the stock of an order back; idempotent */
  @Delete(':orderId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '[Internal] Release branch stock reservation for an order',
    description: 'Idempotently releases branch stock held for an order.',
  })
  @ApiParam({ name: 'orderId', description: 'Order UUID' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Reservation released',
  })
  release(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<void> {
    return this.reservations.release(orderId);
  }
}

function normalizeCreateWarehouseReservationPayload(
  raw: Record<string, any>,
): CreateWarehouseReservationDto {
  if (!raw || typeof raw !== 'object') {
    throw new BadRequestException({
      errorCode: 'INVALID_RESERVATION_PAYLOAD',
      message: 'Reservation request body is required',
    });
  }
  const callerService = (raw.callerService ?? raw.caller_service ?? 'sales') as
    | 'sales'
    | 'inventory'
    | 'integration';
  const sourceRefType = (raw.sourceRefType ??
    raw.source_ref_type ??
    'ORDER') as 'ORDER' | 'TRANSFER' | 'RETURN';
  const sourceRefId =
    raw.sourceRefId ?? raw.source_ref_id ?? raw.orderId ?? raw.order_id;
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  if (
    !sourceRefId ||
    typeof sourceRefId !== 'string' ||
    !UUID_REGEX.test(sourceRefId)
  ) {
    throw new BadRequestException({
      errorCode: 'INVALID_ORDER_ID',
      message: 'sourceRefId (or orderId / order_id) must be a valid UUID',
    });
  }
  if (rawLines.length === 0) {
    throw new BadRequestException({
      errorCode: 'EMPTY_RESERVATION_LINES',
      message: 'lines must contain at least one reservation line',
    });
  }

  let ttlSeconds: number | undefined =
    typeof raw.ttlSeconds === 'number'
      ? raw.ttlSeconds
      : typeof raw.ttl_seconds === 'number'
        ? raw.ttl_seconds
        : undefined;
  const expiresAt = raw.expiresAt ?? raw.expires_at;
  if (!ttlSeconds && typeof expiresAt === 'string') {
    const diffSec = Math.round(
      (new Date(expiresAt).getTime() - Date.now()) / 1000,
    );
    if (Number.isFinite(diffSec) && diffSec > 0) {
      ttlSeconds = Math.max(30, Math.min(86400, diffSec));
    }
  }

  const lines = rawLines.map((line: Record<string, any>) => {
    const skuId = line?.skuId ?? line?.sku_id;
    const warehouseId = line?.warehouseId ?? line?.warehouse_id;
    const qty = String(line?.qty ?? line?.quantity ?? '');
    if (!skuId || !UUID_REGEX.test(String(skuId))) {
      throw new BadRequestException({
        errorCode: 'INVALID_SKU_ID',
        message:
          'Each reservation line requires a valid UUID skuId (or sku_id)',
      });
    }
    if (!warehouseId || !UUID_REGEX.test(String(warehouseId))) {
      throw new BadRequestException({
        errorCode: 'INVALID_WAREHOUSE_ID',
        message:
          'Each reservation line requires a valid UUID warehouseId (or warehouse_id)',
      });
    }
    return {
      skuId: String(skuId),
      warehouseId: String(warehouseId),
      qty,
    };
  });

  return {
    callerService,
    sourceRefType,
    sourceRefId,
    ttlSeconds,
    lines,
  };
}

/**
 * Internal East-West warehouse stock reservation API (`inventory-reservation.openapi.yaml`).
 * Never exposed on the public KrakenD gateway.
 */
@ApiTags('internal')
@Public()
@Controller('internal/v1/reservations')
export class WarehouseReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  @ApiOperation({
    summary: '[Internal] Create or replay a warehouse stock reservation',
    description:
      'Atomically checks available warehouse stock (qty_on_hand - qty_reserved) using row-level locks, increments qty_reserved, and writes an outbox event.',
  })
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: true,
    description: 'Tenant UUID for internal East-West request isolation',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Deterministic idempotency key (UUID) per checkout attempt',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Warehouse reservation created',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Existing warehouse reservation replayed',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Insufficient stock or idempotency payload mismatch',
  })
  async create(
    @Headers(TENANT_ID_HEADER) tenantHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() rawBody: Record<string, any>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tenantId = resolveInternalTenantId(tenantHeader);
    const dto = normalizeCreateWarehouseReservationPayload(rawBody);
    try {
      const { reservation, replayed } = await TenantContext.run(tenantId, () =>
        this.reservations.reserveWarehouseStock(idempotencyKey, dto),
      );
      if (replayed) {
        res.status(HttpStatus.OK);
        res.setHeader('Idempotency-Replayed', 'true');
      } else {
        res.status(HttpStatus.CREATED);
      }
      return reservation;
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get()
  @ApiOperation({
    summary:
      '[Internal] List warehouse reservations by orderId for timeout recovery',
  })
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: true,
    description: 'Tenant UUID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of reservations for the order',
  })
  async listByOrder(
    @Headers(TENANT_ID_HEADER) tenantHeader: string | undefined,
    @Headers('x-order-id') headerOrderId?: string,
    @Query('orderId') queryOrderId?: string,
  ) {
    const tenantId = resolveInternalTenantId(tenantHeader);
    const resolvedOrderId = queryOrderId ?? headerOrderId;
    if (!resolvedOrderId || !UUID_REGEX.test(resolvedOrderId)) {
      throw new BadRequestException({
        errorCode: 'MISSING_ORDER_ID',
        message:
          'Valid orderId query param or X-Order-Id header (UUID) is required',
      });
    }
    return TenantContext.run(tenantId, () =>
      this.reservations.listWarehouseReservationsByOrder(resolvedOrderId),
    );
  }

  @Get('by-key/:idempotencyKey')
  @ApiOperation({
    summary:
      '[Internal] Inspect a warehouse stock reservation by Idempotency-Key',
    description:
      'Used by Sales timeout recovery when the original reservation response timed out before reservationId was received.',
  })
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: true,
    description: 'Tenant UUID',
  })
  @ApiParam({ name: 'idempotencyKey', description: 'Idempotency key' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Warehouse reservation details',
  })
  async getByKey(
    @Headers(TENANT_ID_HEADER) tenantHeader: string | undefined,
    @Param('idempotencyKey') idempotencyKey: string,
  ) {
    const tenantId = resolveInternalTenantId(tenantHeader);
    return TenantContext.run(tenantId, () =>
      this.reservations.getWarehouseReservationByKey(idempotencyKey),
    );
  }

  @Get(':reservationId')
  @ApiOperation({
    summary: '[Internal] Inspect a warehouse stock reservation by ID',
    description:
      'Used by Sales timeout recovery to inspect whether an in-flight reservation succeeded.',
  })
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: true,
    description: 'Tenant UUID',
  })
  @ApiParam({ name: 'reservationId', description: 'Reservation UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Warehouse reservation details',
  })
  async getById(
    @Headers(TENANT_ID_HEADER) tenantHeader: string | undefined,
    @Param('reservationId', new ParseUUIDPipe()) reservationId: string,
  ) {
    const tenantId = resolveInternalTenantId(tenantHeader);
    return TenantContext.run(tenantId, () =>
      this.reservations.getWarehouseReservation(reservationId),
    );
  }

  @Post(':reservationId/commit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Internal] Commit a reserved warehouse stock hold',
    description:
      'Transitions a HELD reservation to COMMITTED and deducts both qty_on_hand and qty_reserved.',
  })
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: true,
    description: 'Tenant UUID',
  })
  @ApiParam({ name: 'reservationId', description: 'Reservation UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reservation committed',
  })
  async commit(
    @Headers(TENANT_ID_HEADER) tenantHeader: string | undefined,
    @Param('reservationId', new ParseUUIDPipe()) reservationId: string,
    @Body()
    body?: { fulfillmentId?: string; fulfillment_id?: string; note?: string },
  ) {
    const tenantId = resolveInternalTenantId(tenantHeader);
    return TenantContext.run(tenantId, () =>
      this.reservations.commitWarehouseReservation(reservationId, {
        fulfillmentId: body?.fulfillmentId ?? body?.fulfillment_id,
        note: body?.note,
      }),
    );
  }

  @Post(':reservationId/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Internal] Release a warehouse stock reservation',
    description:
      'Idempotently transitions a HELD reservation to RELEASED and restores qty_reserved.',
  })
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: true,
    description: 'Tenant UUID',
  })
  @ApiParam({ name: 'reservationId', description: 'Reservation UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reservation released',
  })
  async release(
    @Headers(TENANT_ID_HEADER) tenantHeader: string | undefined,
    @Param('reservationId', new ParseUUIDPipe()) reservationId: string,
    @Body() dto?: ReleaseWarehouseReservationDto & { note?: string },
  ) {
    const tenantId = resolveInternalTenantId(tenantHeader);
    return TenantContext.run(tenantId, () =>
      this.reservations.releaseWarehouseReservation(reservationId, {
        reason: dto?.reason,
        note: dto?.note,
      }),
    );
  }
}
