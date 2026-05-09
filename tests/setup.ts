// twikoo-func eagerly requires axios / form-data at module init — workerd in
// the vitest pool segfaults loading those. Stub the worker's twikoo boundary
// with a superset that covers every consumer; per-test overrides go through
// `vi.mocked(twikooMod.x).mockReturnValueOnce(...)`.

import { vi } from 'vitest';

// Helpers that handler tests override per-call go through `vi.fn()` so
// `vi.mocked(twikooMod.x).mockResolvedValueOnce(...)` works. Pure utilities
// (md5, validate, getUrlsQuery, …) stay as plain arrow functions — handlers
// rely on their behavior, not their callability as mocks.
vi.mock('@/twikoo', () => ({
  VERSION: '0.0.0-test',
  addQQMailSuffix: (m: string) => m,
  commentImportArtalk: vi.fn(async () => []),
  commentImportArtalk2: vi.fn(async () => []),
  commentImportDisqus: vi.fn(async () => []),
  commentImportTwikoo: vi.fn(async () => []),
  commentImportValine: vi.fn(async () => []),
  emailTest: vi.fn(async () => ({})),
  equalsMail: (a: string, b: string) =>
    Boolean(a) && Boolean(b) && a.toLowerCase() === b.toLowerCase(),
  getAvatar: () => '',
  getConfig: vi.fn(async () => ({})),
  getConfigForAdmin: vi.fn(async () => ({})),
  getMailMd5: () => '',
  getPasswordStatus: vi.fn(async () => ({})),
  getUrlsQuery: (urls: string[]) => urls,
  isQQ: () => false,
  jsonParse: (s: string): unknown => JSON.parse(s),
  logger: console,
  md5: (s: string) => `md5(${s})`,
  normalizeMail: (m: string) => m.toLowerCase(),
  parseComment: (rows: unknown) => rows,
  preCheckSpam: () => false,
  sendNotice: async () => undefined,
  sha256: (s: string) => `sha256(${s})`,
  stripCode: <T extends { code?: number }>(o: T): Omit<T, 'code'> => {
    const { code: _code, ...rest } = o;
    return rest;
  },
  validate: () => undefined,
}));
