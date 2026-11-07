import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createFileStorage } from './file-storage';
import { S3FileStorage } from './s3-file-storage';
import { loadUploadsConfig } from './uploads.config';

const KEY = 't/tenant-1/p/11111111-1111-4111-8111-111111111111.png';

function realClient(extra: Record<string, unknown> = {}): S3Client {
  return new S3Client({
    region: 'ap-southeast-1',
    credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-key' },
    ...extra,
  });
}

describe('S3FileStorage presignPut', () => {
  const storage = new S3FileStorage(
    { bucket: 'pbl-images', region: 'ap-southeast-1' },
    realClient(),
  );

  it('signs content-type and content-length and the expiry, without leaking the secret', async () => {
    const { url, headers } = await storage.presignPut(
      KEY,
      'image/png',
      1234,
      900,
    );
    const u = new URL(url);
    expect(u.host).toBe('pbl-images.s3.ap-southeast-1.amazonaws.com');
    expect(u.pathname).toBe(`/${KEY}`);
    expect(u.searchParams.get('X-Amz-Expires')).toBe('900');
    const signed = (u.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
    expect(signed).toEqual(
      expect.arrayContaining(['content-type', 'content-length', 'host']),
    );
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url).not.toContain('secret-key');
    expect(headers).toEqual({ 'Content-Type': 'image/png' });
  });

  it('binds the size: another declared size gives another signature', async () => {
    const a = new URL(
      (await storage.presignPut(KEY, 'image/png', 10, 900)).url,
    );
    const b = new URL(
      (await storage.presignPut(KEY, 'image/png', 11, 900)).url,
    );
    expect(a.searchParams.get('X-Amz-Signature')).not.toBe(
      b.searchParams.get('X-Amz-Signature'),
    );
  });

  it('refuses an unsafe key', async () => {
    await expect(
      storage.presignPut('../x', 'image/png', 1, 900),
    ).rejects.toThrow();
  });

  it('uses path-style addressing with an endpoint override', async () => {
    const local = new S3FileStorage(
      {
        bucket: 'pbl-images',
        region: 'ap-southeast-1',
        endpoint: 'http://localhost:4566',
      },
      realClient({ endpoint: 'http://localhost:4566', forcePathStyle: true }),
    );
    const u = new URL((await local.presignPut(KEY, 'image/png', 1, 60)).url);
    expect(u.origin).toBe('http://localhost:4566');
    expect(u.pathname).toBe(`/pbl-images/${KEY}`);
  });
});

describe('S3FileStorage head, get, delete', () => {
  const sent: unknown[] = [];
  const make = (respond: (command: unknown) => unknown) =>
    new S3FileStorage({ bucket: 'b', region: 'r' }, {
      send: jest.fn(async (command: unknown) => {
        sent.push(command);
        return respond(command);
      }),
    } as never);

  it('maps HEAD to size and a normalised content type', async () => {
    const s = make(() => ({
      ContentLength: 42,
      ContentType: 'Image/PNG; charset=x',
    }));
    expect(await s.head(KEY)).toEqual({ size: 42, contentType: 'image/png' });
    const cmd = sent.at(-1) as HeadObjectCommand;
    expect(cmd).toBeInstanceOf(HeadObjectCommand);
    expect(cmd.input).toEqual({ Bucket: 'b', Key: KEY });
  });

  it('answers null for a missing object (NotFound) and rethrows other errors', async () => {
    const missing = make(() => {
      throw Object.assign(new Error('x'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });
    });
    expect(await missing.head(KEY)).toBeNull();
    expect(await missing.get(KEY)).toBeNull();
    const denied = make(() => {
      throw Object.assign(new Error('denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
    });
    await expect(denied.head(KEY)).rejects.toThrow('denied');
  });

  it('reads the object body and deletes by key', async () => {
    const s = make((c) =>
      c instanceof GetObjectCommand
        ? { Body: { transformToByteArray: async () => Buffer.from('hi') } }
        : {},
    );
    expect((await s.get(KEY))?.toString()).toBe('hi');
    await s.delete(KEY);
    expect(sent.at(-1)).toBeInstanceOf(DeleteObjectCommand);
  });
});

describe('S3FileStorage publicUrl', () => {
  it('prefers the CloudFront base, then the endpoint, then the bucket URL', () => {
    const base = { bucket: 'b', region: 'ap-southeast-1' };
    expect(
      new S3FileStorage(
        { ...base, publicBaseUrl: 'https://static.example.com/' },
        realClient(),
      ).publicUrl(KEY),
    ).toBe(`https://static.example.com/${KEY}`);
    expect(
      new S3FileStorage(
        { ...base, endpoint: 'http://localhost:4566' },
        realClient(),
      ).publicUrl(KEY),
    ).toBe(`http://localhost:4566/b/${KEY}`);
    expect(new S3FileStorage(base, realClient()).publicUrl(KEY)).toBe(
      `https://b.s3.ap-southeast-1.amazonaws.com/${KEY}`,
    );
  });
});

describe('uploads config', () => {
  it('defaults to local and rejects an unknown driver', () => {
    expect(loadUploadsConfig({}).driver).toBe('local');
    expect(() => loadUploadsConfig({ UPLOADS_DRIVER: 'ftp' })).toThrow(
      /UPLOADS_DRIVER/,
    );
  });

  it('needs bucket and region for s3 and builds the S3 adapter', () => {
    expect(() => loadUploadsConfig({ UPLOADS_DRIVER: 's3' })).toThrow(
      /AWS_S3_BUCKET/,
    );
    const storage = createFileStorage({
      UPLOADS_DRIVER: 's3',
      AWS_S3_BUCKET: 'b',
      AWS_S3_REGION: 'ap-southeast-1',
      UPLOADS_PUBLIC_BASE_URL: 'https://static.example.com',
    });
    expect(storage).toBeInstanceOf(S3FileStorage);
    expect(storage.direct).toBe(true);
  });
});
