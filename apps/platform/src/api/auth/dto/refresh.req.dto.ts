import { StringField } from '@/decorators/field.decorators';

export class RefreshReqDto {
  // Opaque random token (32 bytes, base64url), not a JWT — ADR-0004 §6
  @StringField({ minLength: 43, maxLength: 43 })
  refreshToken!: string;
}
