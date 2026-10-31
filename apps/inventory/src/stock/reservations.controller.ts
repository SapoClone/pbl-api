import {
  Body,
  ConflictException,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@pbl/auth';
import { StockReservation } from '@pbl/contracts';
import type { Response } from 'express';
import { ReserveStockReqDto } from './dto/stock.dto';
import {
  ReservationMismatchError,
  ReservationsService,
  StockShortageError,
} from './reservations.service';
import { InventoryErrorCode } from './stock.service';

/**
 * The command `sales` sends before it sells. Internal: it is not declared in
 * `krakend.json`, so the gateway answers 404 for it. The caller forwards the user's
 * token, so inventory verifies the user and takes the tenant from it.
 */
@ApiTags('internal')
@ApiBearerAuth()
@Controller('internal/reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /**
   * 201 when the stock is held, 200 for an order that was already held, 409 with the shortages otherwise.
   * Sales calls this with the user's own token when an order is created (`pos.create`, `orders.create`)
   * and when a draft is confirmed (`orders.update`), so all three open it.
   */
  @Post()
  @RequirePermission('pos.create', 'orders.create', 'orders.update')
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

  /** Gives the stock of an order back; idempotent. Also called on cancel (`orders.delete`). */
  @Delete(':orderId')
  @RequirePermission(
    'pos.create',
    'orders.create',
    'orders.update',
    'orders.delete',
  )
  @HttpCode(HttpStatus.NO_CONTENT)
  release(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<void> {
    return this.reservations.release(orderId);
  }
}
