import { Controller, Get, Module } from '@nestjs/common';
import request from 'supertest';
import { bootstrapService } from './bootstrap-service';

@Controller()
class PingController {
  @Get('ping')
  ping() {
    return 'pong';
  }
}

@Module({ controllers: [PingController] })
class NoLoggingModule {}

describe('bootstrapService', () => {
  it('boots a module tree without PblLoggingModule, keeping the default logger', async () => {
    const app = await bootstrapService(NoLoggingModule, {
      name: 'probe',
      port: 0,
    });
    try {
      await request(app.getHttpServer()).get('/ping').expect(200);
      const miss = await request(app.getHttpServer()).get('/nope').expect(404);
      expect(miss.body.error).toBe('Not Found');
    } finally {
      await app.close();
    }
  });
});
