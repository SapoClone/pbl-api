import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from '@pbl/auth';

@Public()
@Controller('health')
export class HealthController {
  check(): { status: string; service: string } {
    return { status: 'ok', service: 'finance' };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  getHealth() {
    return this.check();
  }
}
