import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorDetailDto } from './error-detail.dto';

export class ErrorDto {
  @ApiProperty()
  timestamp: string;

  @ApiProperty()
  statusCode: number;

  @ApiProperty()
  error: string;

  @ApiPropertyOptional()
  errorCode?: string;

  @ApiProperty()
  message: string;

  /** Field errors of a 422, or the facts of a 409 such as the plan limit (`key`, `used`, `limit`, `planCode`) */
  @ApiPropertyOptional({ type: ErrorDetailDto, isArray: true })
  details?: ErrorDetailDto[] | Record<string, unknown>;

  stack?: string;

  trace?: Error | unknown;
}
