import { vi } from 'vitest';

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
    Boolean(a) && Boolean(b) && a.trim().toLowerCase() === b.trim().toLowerCase(),
  getAvatar: () => '',
  getConfig: vi.fn(async () => ({})),
  getConfigForAdmin: vi.fn(async () => ({})),
  getFuncVersion: vi.fn(() => ({ code: 0, version: '0.0.0-test' })),
  getMailMd5: () => '',
  getPasswordStatus: vi.fn(async () => ({})),
  getUrlsQuery: (urls: string[]) =>
    urls.flatMap((url) => (url ? [url, url.endsWith('/') ? url.slice(0, -1) : `${url}/`] : [])),
  isQQ: () => false,
  jsonParse: (s: string): unknown => JSON.parse(s),
  logger: console,
  md5: (s: string) => `md5(${s})`,
  normalizeMail: (m: string) => m.trim().toLowerCase(),
  parseComment: vi.fn((rows: Array<Record<string, unknown>>, uid: string) => {
    const toDto = (row: Record<string, unknown>, replies: unknown[] = []) => {
      const ups = Array.isArray(row.ups) ? row.ups : [];
      const downs = Array.isArray(row.downs) ? row.downs : [];
      return {
        id: row._id,
        nick: row.nick,
        avatar: row.avatar,
        mailMd5: row.mailMd5,
        link: row.link,
        comment: row.comment,
        os: '',
        browser: '',
        ipRegion: '',
        master: row.master,
        like: 0,
        ups: ups.length,
        downs: downs.length,
        liked: ups.includes(uid),
        disliked: downs.includes(uid),
        replies,
        rid: row.rid,
        pid: row.pid,
        ruser: row.pid ? (rows.find((comment) => comment._id === row.pid)?.nick ?? null) : null,
        top: row.top,
        isSpam: row.isSpam,
        isOwner: row.uid === uid,
        created: row.created,
        updated: row.updated,
      };
    };
    return rows
      .filter((row) => !row.rid)
      .map((head) =>
        toDto(
          head,
          rows
            .filter((reply) => reply.rid === head._id)
            .sort((a, b) => Number(a.created) - Number(b.created))
            .map((reply) => toDto(reply)),
        ),
      );
  }),
  preCheckSpam: vi.fn(() => false),
  sendNotice: vi.fn(async () => undefined),
  sha256: (s: string) => `sha256(${s})`,
  stripCode: <T extends { code?: number }>(o: T): Omit<T, 'code'> => {
    const { code: _code, ...rest } = o;
    return rest;
  },
  validate: (event: Record<string, unknown>, requiredFields: readonly string[]) => {
    for (const field of requiredFields) {
      if (!event[field]) {
        throw new Error(`参数"${field}"不合法`);
      }
    }
  },
}));
