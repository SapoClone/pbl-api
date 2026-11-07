import { tmpdir } from 'os';
import { join } from 'path';

export type UploadsDriver = 's3' | 'local';

export interface S3Config {
  bucket: string;
  region: string;
  /** `AWS_ENDPOINT_URL_S3`: an S3 emulator; turns on path-style addressing. */
  endpoint?: string;
  /** `UPLOADS_PUBLIC_BASE_URL`: the CloudFront domain that serves the bucket; falls back to the bucket URL. */
  publicBaseUrl?: string;
}

export interface UploadsConfig {
  driver: UploadsDriver;
  s3: S3Config;
  localDir: string;
}

/**
 * The one place the upload environment is read and validated.
 * `UPLOADS_DRIVER=s3|local` (default `local`; production sets `s3`). `s3` needs `AWS_S3_BUCKET` and a region
 * (`AWS_S3_REGION`, else `AWS_REGION`); a missing value stops the service at boot instead of failing on the first upload.
 */
export function loadUploadsConfig(
  env: NodeJS.ProcessEnv = process.env,
): UploadsConfig {
  const driver = (env.UPLOADS_DRIVER || 'local').trim().toLowerCase();
  if (driver !== 's3' && driver !== 'local') {
    throw new Error(`UPLOADS_DRIVER must be "s3" or "local", got "${driver}"`);
  }
  const bucket = env.AWS_S3_BUCKET?.trim() ?? '';
  const region = (env.AWS_S3_REGION || env.AWS_REGION || '').trim();
  if (driver === 's3' && (!bucket || !region)) {
    throw new Error(
      'UPLOADS_DRIVER=s3 needs AWS_S3_BUCKET and AWS_S3_REGION (or AWS_REGION)',
    );
  }
  return {
    driver,
    s3: {
      bucket,
      region,
      endpoint: env.AWS_ENDPOINT_URL_S3?.trim() || undefined,
      publicBaseUrl: env.UPLOADS_PUBLIC_BASE_URL?.trim() || undefined,
    },
    localDir: env.CATALOG_UPLOAD_DIR || join(tmpdir(), 'pbl-catalog-uploads'),
  };
}
