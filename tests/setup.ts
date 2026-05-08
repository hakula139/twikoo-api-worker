// twikoo-func eagerly requires axios / form-data at module init — workerd in
// the vitest pool segfaults loading those. Stub the worker's twikoo boundary
// with a superset that covers every consumer; per-test overrides go through
// `vi.mocked(twikooMod.x).mockReturnValueOnce(...)`.

import { vi } from 'vitest';

vi.mock('@/twikoo', () => ({
  addQQMailSuffix: (m: string) => m,
  equalsMail: (a: string, b: string) =>
    Boolean(a) && Boolean(b) && a.toLowerCase() === b.toLowerCase(),
  getAvatar: () => '',
  getMailMd5: () => '',
  getUrlsQuery: (urls: string[]) => urls,
  isQQ: () => false,
  logger: console,
  md5: (s: string) => `md5(${s})`,
  normalizeMail: (m: string) => m.toLowerCase(),
  parseComment: (rows: unknown) => rows,
  preCheckSpam: () => false,
  sendNotice: async () => undefined,
  sha256: (s: string) => `sha256(${s})`,
  validate: () => undefined,
}));
