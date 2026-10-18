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
import { RequireRoles } from '@pbl/auth';
import { ROLES, StockReservation } from '@pbl/contracts';
import type { Response } from 'express';
import { ReserveStockReqDto } from './dto/stock.dto';
import {
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
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
@Controller('internal/reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** 201 when the stock is held, 200 for an order that was already held, 409 with the shortages otherwise */
  @Post()
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
      throw error;
    }
  }

  /** Gives the stock of an order back; idempotent */
  @Delete(':orderId')
  @HttpCode(HttpStatus.NO_CONTENT)
  release(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<void> {
    return this.reservations.release(orderId);
  }
}
