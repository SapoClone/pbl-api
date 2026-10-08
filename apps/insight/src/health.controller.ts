import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

@Controller('health')
export class HealthController {
  check(): { status: string; service: string } {
    return { status: 'ok', service: 'insight' };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  getHealth() {
    return this.check();
  }
}
