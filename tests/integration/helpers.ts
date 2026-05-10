import { env, exports } from 'cloudflare:workers';

interface JsonResponseBody {
  code: number;
  message?: string;
  [key: string]: unknown;
}

const ORIGIN = 'https://blog.example';

// `exports.default.fetch` runs the worker entry in the same isolate as the
// test, so the global `vi.mock('@/twikoo')` from setup.ts still applies.
const callWorker = (init: RequestInit, headers?: HeadersInit): Promise<Response> => {
  const merged = new Headers(headers);
  if (!merged.has('Origin')) {
    merged.set('Origin', ORIGIN);
  }
  if (init.body !== undefined && init.body !== null && !merged.has('Content-Type')) {
    merged.set('Content-Type', 'application/json');
  }
  return exports.default.fetch(
    new Request('https://twikoo.example/api', { ...init, headers: merged }),
  );
};

export const postEvent = async <E extends string>(
  event: E,
  payload: Record<string, unknown> = {},
  headers?: HeadersInit,
): Promise<{ status: number; body: JsonResponseBody; headers: Headers }> => {
  const res = await callWorker(
    { method: 'POST', body: JSON.stringify({ event, ...payload }) },
    headers,
  );
  const body = await res.json<JsonResponseBody>();
  return { status: res.status, body, headers: res.headers };
};

export const postRaw = async (
  body: string,
  headers?: HeadersInit,
): Promise<{ status: number; body: JsonResponseBody; headers: Headers }> => {
  const res = await callWorker({ method: 'POST', body }, headers);
  const json = await res.json<JsonResponseBody>();
  return { status: res.status, body: json, headers: res.headers };
};

export const sendRequest = (init: RequestInit, headers?: HeadersInit): Promise<Response> =>
  callWorker(init, headers);

// Seeds the single `config` row with the provided JSON object. Replaces any
// prior row so tests can set their own config without per-test cleanup.
export const seedConfig = async (config: Record<string, unknown>): Promise<void> => {
  await env.DB.prepare('INSERT OR REPLACE INTO config (id, value) VALUES (?, ?)')
    .bind(0, JSON.stringify(config))
    .run();
};

// Mocked `md5(s)` returns `md5(${s})`, so writing `ADMIN_PASS` as
// `md5(<token>)` and sending `accessToken: '<token>'` makes the bearer admin.
export const ADMIN_TOKEN = 'integration-admin';
export const ADMIN_PASS_PLAINTEXT = 'integration-password';

export const seedAdmin = async (extras: Record<string, unknown> = {}): Promise<void> => {
  await seedConfig({ ADMIN_PASS: `md5(${ADMIN_TOKEN})`, ...extras });
};

export const adminAuthHeader = (token = ADMIN_TOKEN): { 'x-twikoo-recaptcha-v3': string } => ({
  'x-twikoo-recaptcha-v3': token,
});

export interface CommentRowSeed {
  _id?: string;
  uid?: string;
  url?: string;
  comment?: string;
  nick?: string;
  mail?: string;
  created?: number;
  ups?: string;
  downs?: string;
  isSpam?: 0 | 1;
  top?: 0 | 1;
  rid?: string;
  pid?: string;
}

let seq = 0;
const nextId = (): string => `cmt-${Date.now()}-${++seq}`;

export const seedComment = async (row: CommentRowSeed = {}): Promise<string> => {
  const id = row._id ?? nextId();
  const created = row.created ?? Date.now();
  await env.DB.prepare(
    `INSERT INTO comment (
        _id, uid, nick, mail, mailMd5, link, ua, ip, ipRegion, master,
        url, href, comment, pid, rid, isSpam, created, updated, ups, downs, top, avatar
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      row.uid ?? '',
      row.nick ?? 'Anon',
      row.mail ?? '',
      '',
      '',
      'integration-ua',
      '127.0.0.1',
      '',
      0,
      row.url ?? '/post/',
      '',
      row.comment ?? '<p>seed</p>',
      row.pid ?? '',
      row.rid ?? '',
      row.isSpam ?? 0,
      created,
      created,
      row.ups ?? '[]',
      row.downs ?? '[]',
      row.top ?? 0,
      '',
    )
    .run();
  return id;
};

export const fetchComments = async (url = '/post/'): Promise<Array<Record<string, unknown>>> => {
  const result = await env.DB.prepare(
    'SELECT _id, isSpam, top, comment FROM comment WHERE url = ? ORDER BY created ASC',
  )
    .bind(url)
    .all<Record<string, unknown>>();
  return result.results;
};
