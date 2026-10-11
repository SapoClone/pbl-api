import {
  BadRequestException,
  Body,
  Controller,
  Get,
  INestApplication,
  NotFoundException,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsInt, IsString } from 'class-validator';
import request from 'supertest';
import { PblExceptionFilter } from './pbl-exception.filter';
import { validationExceptionFactory } from './validation-exception.factory';

class Dto {
  @IsString()
  name: string;

  @IsInt()
  age: number;
}

@Controller()
class ProbeController {
  @Get('not-found')
  notFound() {
    throw new NotFoundException('Nothing here');
  }

  @Get('coded')
  coded() {
    throw new BadRequestException({
      message: 'Bad thing',
      errorCode: 'X001',
    });
  }

  @Get('boom')
  boom() {
    throw new Error('secret internals');
  }

  @Post('validate')
  validate(@Body() body: Dto) {
    return body;
  }
}

describe('PblExceptionFilter', () => {
  let app: INestApplication;

  async function boot() {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new PblExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    );
    await app.init();
  }

  const savedDebug = process.env.APP_DEBUG;

  beforeEach(() => {
    delete process.env.APP_DEBUG; // the runtime env may enable it
  });

  afterEach(async () => {
    await app?.close();
  });

  afterAll(() => {
    if (savedDebug !== undefined) process.env.APP_DEBUG = savedDebug;
  });

  it('maps an HttpException to the standard shape', async () => {
    await boot();
    const res = await request(app.getHttpServer())
      .get('/not-found')
      .expect(404);
    expect(res.body).toEqual({
      timestamp: expect.any(String),
      statusCode: 404,
      error: 'Not Found',
      message: 'Nothing here',
    });
  });

  it('keeps errorCode from the exception response', async () => {
    await boot();
    const res = await request(app.getHttpServer()).get('/coded').expect(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Bad thing',
      errorCode: 'X001',
    });
  });

  it('returns 422 with details for validation failures', async () => {
    await boot();
    const res = await request(app.getHttpServer())
      .post('/validate')
      .send({ name: 5, age: 'x' })
      .expect(422);
    expect(res.body.statusCode).toBe(422);
    expect(res.body.error).toBe('Unprocessable Entity');
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'name',
          code: 'isString',
          message: expect.any(String),
        }),
        expect.objectContaining({ property: 'age', code: 'isInt' }),
      ]),
    );
  });

  it('turns unknown errors into a bare 500 without a stack', async () => {
    await boot();
    const res = await request(app.getHttpServer()).get('/boom').expect(500);
    expect(res.body).toEqual({
      timestamp: expect.any(String),
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal Server Error',
    });
  });

  it('adds the stack only when APP_DEBUG=true', async () => {
    process.env.APP_DEBUG = 'true';
    await boot();
    const res = await request(app.getHttpServer()).get('/boom').expect(500);
    expect(res.body.stack).toContain('secret internals');
    expect(res.body.message).toBe('Internal Server Error');
  });
});
