import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';
import { S3FileStorage } from './s3-file-storage';
import { assertSafeKey } from './safe-key';
import { loadUploadsConfig } from './uploads.config';

/** Injection token of the storage adapter (S3 in production, local disk or memory otherwise). */
export const FILE_STORAGE = Symbol('CATALOG_FILE_STORAGE');

/** What an object store says about a stored object (S3 HEAD). */
export interface StoredObjectInfo {
  size: number;
  contentType: string | null;
}

/** A URL the client sends the file to, and the headers it must send with it. */
export interface PresignedPut {
  url: string;
  headers: Record<string, string>;
}

export interface FileStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** Size and content type of the object, or `null` when it does not exist. */
  head(key: string): Promise<StoredObjectInfo | null>;
  /**
   * A PUT URL for `key`, valid `expiresInSeconds`. The S3 adapter signs Content-Type and Content-Length, so the client
   * cannot send another type or size. The local adapters answer with the API's own content URL.
   */
  presignPut(
    key: string,
    contentType: string,
    size: number,
    expiresInSeconds: number,
  ): Promise<PresignedPut>;
  /** The link browsers load the object from (CloudFront or the bucket); this is what products store. */
  publicUrl(key: string): string;
  /** `true` when bytes go straight to the store, so `PUT /uploads/{id}/content` is closed. */
  readonly direct: boolean;
}

/** Upload id out of `t/<tenant>/p/<uploadId>.<ext>`: the local adapters point the client at the API. */
function apiContentUrl(key: string, contentType: string): PresignedPut {
  const id = (key.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
  return {
    url: `/catalog/api/v1/uploads/${id}/content`,
    headers: { 'Content-Type': contentType },
  };
}

function staticUrl(key: string): string {
  const base = (process.env.CATALOG_ASSET_BASE_URL || '/static').replace(
    /\/+$/,
    '',
  );
  return `${base}/${key}`;
}

export class InMemoryFileStorage implements FileStorage {
  readonly direct: boolean = false;
  private readonly files = new Map<string, Buffer>();
  private readonly types = new Map<string, string>();

  async put(key: string, data: Buffer, contentType?: string): Promise<void> {
    assertSafeKey(key);
    this.files.set(key, Buffer.from(data));
    if (contentType) this.types.set(key, contentType);
  }

  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    return this.files.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    this.files.delete(key);
    this.types.delete(key);
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    assertSafeKey(key);
    const data = this.files.get(key);
    if (!data) return null;
    return { size: data.length, contentType: this.types.get(key) ?? null };
  }

  async presignPut(
    key: string,
    contentType: string,
    _size?: number,
  ): Promise<PresignedPut> {
    assertSafeKey(key);
    return apiContentUrl(key, contentType);
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    return staticUrl(key);
  }
}

export class LocalDiskFileStorage implements FileStorage {
  readonly direct = false;
  private readonly root: string;
  /** Content types seen by this process (the disk keeps bytes only). */
  private readonly types = new Map<string, string>();

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    assertSafeKey(key);
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) {
      throw new Error(`Storage key escapes the root: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer, contentType?: string): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    if (contentType) this.types.set(key, contentType);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
    this.types.delete(key);
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const info = await stat(this.path(key));
      return { size: info.size, contentType: this.types.get(key) ?? null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async presignPut(key: string, contentType: string): Promise<PresignedPut> {
    this.path(key);
    return apiContentUrl(key, contentType);
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    return staticUrl(key);
  }
}

/** Picks the adapter from `UPLOADS_DRIVER` (see `uploads.config.ts`); `CATALOG_STORAGE_DRIVER=memory` is for tests. */
export function createFileStorage(
  env: NodeJS.ProcessEnv = process.env,
): FileStorage {
  const config = loadUploadsConfig(env);
  if (config.driver === 's3') return new S3FileStorage(config.s3);
  if (env.CATALOG_STORAGE_DRIVER === 'memory') return new InMemoryFileStorage();
  return new LocalDiskFileStorage(config.localDir);
}

/** Where a stored image is reachable under the local static host (`CATALOG_ASSET_BASE_URL`). */
export function publicUrlFor(tenantId: string, imageId: string, ext: string) {
  return staticUrl(`t/${tenantId}/p/${imageId}.${ext}`);
}

export { assertSafeKey };
