import type { Env } from '@/types';

export type R2Env = Pick<Env, 'R2' | 'R2_PUBLIC_URL'>;

export interface UploadResult {
  url: string;
  [key: string]: unknown;
}

export interface DecodedPhoto {
  blob: Blob;
  bytes: Uint8Array;
  mimeType: string;
}
