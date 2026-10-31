import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve, sep } from 'path';

/** Injection token of the storage adapter (swap it for an object-store adapter later). */
export const FILE_STORAGE = Symbol('CATALOG_FILE_STORAGE');

export interface FileStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

/** Keys are built by the service from uuids; anything else is refused. */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9_./-]*$/;

function assertSafeKey(key: string): void {
  if (
    !SAFE_KEY.test(key) ||
    key.split('/').some((p) => p === '..' || p === '')
  ) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

export class InMemoryFileStorage implements FileStorage {
  private readonly files = new Map<string, Buffer>();

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    assertSafeKey(key);
    this.files.set(key, Buffer.from(data));
  }

  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    return this.files.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    this.files.delete(key);
  }
}

export class LocalDiskFileStorage implements FileStorage {
  private readonly root: string;

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

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
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
  }
}

/** `CATALOG_STORAGE_DRIVER=memory` for tests; default is local disk under `CATALOG_UPLOAD_DIR`. */
export function createFileStorage(): FileStorage {
  if (process.env.CATALOG_STORAGE_DRIVER === 'memory') {
    return new InMemoryFileStorage();
  }
  return new LocalDiskFileStorage(
    process.env.CATALOG_UPLOAD_DIR || join(tmpdir(), 'pbl-catalog-uploads'),
  );
}

/** Where a stored image is reachable by browsers (static host or CDN in front of the storage). */
export function publicUrlFor(tenantId: string, imageId: string, ext: string) {
  const base = (process.env.CATALOG_ASSET_BASE_URL || '/static').replace(
    /\/+$/,
    '',
  );
  return `${base}/t/${tenantId}/p/${imageId}.${ext}`;
}
