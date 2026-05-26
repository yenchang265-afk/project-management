// S3 (MinIO-compatible) client + presign helpers.
//
// Lazily constructed so that unit tests that never touch S3 don't blow up on
// missing env vars. Production callers should set S3_ENDPOINT, S3_ACCESS_KEY,
// S3_SECRET_KEY, S3_BUCKET, S3_REGION.
//
// Tests inject a stub via `__setS3ClientForTesting`.

import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type PresignableClient = {
  send: (command: unknown) => Promise<unknown>;
};

let client: S3Client | PresignableClient | null = null;

function buildClient(): S3Client {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  const region = process.env.S3_REGION ?? 'us-east-1';
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3 client not configured. Set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY env vars.',
    );
  }
  return new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export function getS3Client(): S3Client | PresignableClient {
  if (!client) client = buildClient();
  return client;
}

export function getBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET env var not set');
  return bucket;
}

export function __setS3ClientForTesting(stub: PresignableClient | null): void {
  client = stub;
}

export function __resetS3ClientForTesting(): void {
  client = null;
}

export async function presignPut(
  key: string,
  contentType: string,
  expiresInSec = 900,
): Promise<string> {
  const c = getS3Client();
  // If a test stub provided a presignPut, use it directly.
  const maybeTest = c as PresignableClient & {
    presignPut?: (key: string, ct: string, exp: number) => Promise<string>;
  };
  if (typeof maybeTest.presignPut === 'function') {
    return maybeTest.presignPut(key, contentType, expiresInSec);
  }
  const cmd = new PutObjectCommand({ Bucket: getBucket(), Key: key, ContentType: contentType });
  return getSignedUrl(c as S3Client, cmd, { expiresIn: expiresInSec });
}

export async function presignGet(
  key: string,
  filename?: string,
  expiresInSec = 900,
): Promise<string> {
  const c = getS3Client();
  const maybeTest = c as PresignableClient & {
    presignGet?: (key: string, fn: string | undefined, exp: number) => Promise<string>;
  };
  if (typeof maybeTest.presignGet === 'function') {
    return maybeTest.presignGet(key, filename, expiresInSec);
  }
  // ResponseContentDisposition forces a download rather than inline rendering,
  // preventing uploaded HTML/SVG from being executed in the browser.
  const disposition = filename
    ? `attachment; filename="${filename.replace(/"/g, '_')}"`
    : 'attachment';
  const cmd = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ResponseContentDisposition: disposition,
  });
  return getSignedUrl(c as S3Client, cmd, { expiresIn: expiresInSec });
}

export async function deleteObject(key: string): Promise<void> {
  const c = getS3Client();
  const maybeTest = c as PresignableClient & {
    deleteObject?: (key: string) => Promise<void>;
  };
  if (typeof maybeTest.deleteObject === 'function') {
    return maybeTest.deleteObject(key);
  }
  await (c as S3Client).send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}
