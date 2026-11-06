import fs from 'node:fs/promises';
import path from 'node:path';
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Penyimpanan file. STORAGE_DRIVER:
 *   local (default) — folder STORAGE_DIR (default: server/uploads)
 *   s3              — AWS S3 / MinIO / Cloudflare R2 / Wasabi (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION)
 */
export interface Storage { name: string; put(key: string, data: Buffer, contentType: string): Promise<void>; get(key: string): Promise<Buffer> }

class LocalStorage implements Storage {
  name = 'local';
  constructor(private dir: string) {}
  private full(key: string) {
    const p = path.resolve(this.dir, key);
    if (!p.startsWith(path.resolve(this.dir) + path.sep)) throw new Error('Kunci file tidak valid');
    return p;
  }
  async put(key: string, data: Buffer) { const p = this.full(key); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, data, { flag: 'wx' }); }
  async get(key: string) { return fs.readFile(this.full(key)); }
}

class S3Storage implements Storage {
  name = 's3';
  private c: S3Client;
  constructor(private bucket: string) {
    this.c = new S3Client({
      region: process.env.S3_REGION || 'us-east-1', endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: process.env.S3_ACCESS_KEY ? { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY ?? '' } : undefined,
    });
  }
  private ready: Promise<void> | null = null;
  /** Buat bucket bila belum ada (S3_CREATE_BUCKET=true, mis. MinIO di server sendiri). */
  private ensure() {
    if (process.env.S3_CREATE_BUCKET !== 'true') return Promise.resolve();
    this.ready ??= (async () => {
      try { await this.c.send(new HeadBucketCommand({ Bucket: this.bucket })); }
      catch { await this.c.send(new CreateBucketCommand({ Bucket: this.bucket })); }
    })().catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.ensure();
    await this.c.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, ServerSideEncryption: process.env.S3_SSE === 'false' ? undefined : 'AES256' }));
  }
  async get(key: string) {
    const r = await this.c.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
}

let st: Storage | null = null;
export function getStorage(): Storage {
  if (st) return st;
  if ((process.env.STORAGE_DRIVER ?? 'local') === 's3') {
    if (!process.env.S3_BUCKET) throw new Error('STORAGE_DRIVER=s3 tetapi S3_BUCKET kosong');
    st = new S3Storage(process.env.S3_BUCKET);
  } else st = new LocalStorage(process.env.STORAGE_DIR || path.resolve(process.cwd(), 'uploads'));
  return st;
}

/** Deteksi tipe dari isi file (bukan dari nama / header yang bisa dipalsukan). */
export function sniffType(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b.length > 5 && b.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}
