import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  FileStorage,
  PresignedPut,
  StoredObjectInfo,
} from './file-storage';
import { assertSafeKey } from './safe-key';
import type { S3Config } from './uploads.config';

function isMissing(error: unknown): boolean {
  const e = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    e?.name === 'NotFound' ||
    e?.name === 'NoSuchKey' ||
    e?.$metadata?.httpStatusCode === 404
  );
}

/**
 * Objects live in a private bucket. Clients upload straight to S3 with a presigned PUT; the API only presigns, checks
 * (HEAD) and deletes. Credentials come from the default AWS chain (the ECS task role) and never leave this class.
 * `client` is injectable so tests can pass a fake (its `send` receives the SDK commands).
 */
export class S3FileStorage implements FileStorage {
  readonly direct = true;
  private readonly client: S3Client;

  constructor(
    private readonly config: S3Config,
    client?: Pick<S3Client, 'send'> & Partial<S3Client>,
  ) {
    this.client =
      (client as S3Client | undefined) ??
      new S3Client({
        region: config.region,
        ...(config.endpoint
          ? { endpoint: config.endpoint, forcePathStyle: true }
          : {}),
      });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      if (!out.Body) return null;
      return Buffer.from(await out.Body.transformToByteArray());
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    assertSafeKey(key);
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return {
        size: out.ContentLength ?? 0,
        contentType:
          out.ContentType?.split(';')[0].trim().toLowerCase() ?? null,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async presignPut(
    key: string,
    contentType: string,
    size: number,
    expiresInSeconds: number,
  ): Promise<PresignedPut> {
    assertSafeKey(key);
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      {
        expiresIn: expiresInSeconds,
        // signed headers must be sent unchanged: another type or size makes S3 answer 403
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    // Content-Length is signed too; browsers and curl add it from the body themselves.
    return { url, headers: { 'Content-Type': contentType } };
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    const { publicBaseUrl, endpoint, bucket, region } = this.config;
    if (publicBaseUrl) return `${publicBaseUrl.replace(/\/+$/, '')}/${key}`;
    if (endpoint) return `${endpoint.replace(/\/+$/, '')}/${bucket}/${key}`;
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }
}
