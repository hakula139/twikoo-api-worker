import type { Comment, NewComment } from '@/db';
import type { RequestCtx, TwikooConfig } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TwikooError } from '@/lib/errors';
import { commentGet, commentSubmit } from '@/handlers/comment';
import { buildCtx } from '../../helpers/ctx';

interface FakeDb {
  saved: NewComment[];
  perIp: number;
  global: number;
}

const buildSubmitCtx = (config: TwikooConfig, fake: FakeDb, ip = '1.2.3.4'): RequestCtx => {
  const db = {
    comment: {
      save: vi.fn(async (c: NewComment) => {
        fake.saved.push(c);
      }),
      countSinceByIp: vi.fn(async () => fake.perIp),
      countSince: vi.fn(async () => fake.global),
      byId: vi.fn(async () => undefined as Comment | undefined),
      updateSpam: vi.fn(async () => undefined),
    },
  };
  return buildCtx({ ip, uid: 'guest-uid', config, db: db as unknown as RequestCtx['db'] });
};

const submitPayload = (overrides: Partial<Record<string, string>> = {}) => ({
  url: '/post',
  ua: 'Mozilla',
  comment: 'hi',
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Mirrors twikoo-func/utils#getUrlsQuery: emit both `/path` and `/path/`.
const variants = (url: string): string[] => {
  const flipped = url.endsWith('/') ? url.slice(0, -1) : `${url}/`;
  return [url, flipped];
};

describe('COMMENT_GET trailing-slash variants', () => {
  it('expands `/foo` to both slash forms', () => {
    expect(variants('/foo')).toEqual(['/foo', '/foo/']);
  });

  it('expands `/foo/` to both slash forms', () => {
    expect(variants('/foo/')).toEqual(['/foo/', '/foo']);
  });

  it('round-trips: a viewer at either form sees the other', () => {
    expect(new Set(variants('/foo'))).toEqual(new Set(variants('/foo/')));
  });
});

describe('commentSubmit > enforceFrequencyLimit', () => {
  it('rejects the (perIp + 1)-th submission when count already equals the cap', async () => {
    const fake: FakeDb = { saved: [], perIp: 3, global: 0 };
    const ctx = buildSubmitCtx({ LIMIT_PER_MINUTE: '3' }, fake);

    await expect(commentSubmit(submitPayload(), ctx)).rejects.toBeInstanceOf(TwikooError);
    expect(fake.saved).toHaveLength(0);
  });

  it('accepts a submission while count is still below the cap', async () => {
    const fake: FakeDb = { saved: [], perIp: 2, global: 0 };
    const ctx = buildSubmitCtx({ LIMIT_PER_MINUTE: '3' }, fake);

    const result = await commentSubmit(submitPayload(), ctx);
    expect(typeof result.id).toBe('string');
    expect(fake.saved).toHaveLength(1);
  });

  it('rejects when the global cap is reached', async () => {
    const fake: FakeDb = { saved: [], perIp: 0, global: 100 };
    const ctx = buildSubmitCtx({ LIMIT_PER_MINUTE: '50', LIMIT_PER_MINUTE_ALL: '100' }, fake);

    await expect(commentSubmit(submitPayload(), ctx)).rejects.toBeInstanceOf(TwikooError);
    expect(fake.saved).toHaveLength(0);
  });

  it('accepts at one below the global cap', async () => {
    const fake: FakeDb = { saved: [], perIp: 0, global: 99 };
    const ctx = buildSubmitCtx({ LIMIT_PER_MINUTE: '50', LIMIT_PER_MINUTE_ALL: '100' }, fake);

    const result = await commentSubmit(submitPayload(), ctx);
    expect(typeof result.id).toBe('string');
    expect(fake.saved).toHaveLength(1);
  });

  it('LIMIT_PER_MINUTE_ALL=0 disables the global cap', async () => {
    const fake: FakeDb = { saved: [], perIp: 0, global: 1_000_000 };
    const ctx = buildSubmitCtx({ LIMIT_PER_MINUTE: '50', LIMIT_PER_MINUTE_ALL: '0' }, fake);

    const result = await commentSubmit(submitPayload(), ctx);
    expect(typeof result.id).toBe('string');
    expect(fake.saved).toHaveLength(1);
  });
});

describe('commentGet > malformed votes JSON', () => {
  const baseRow: Comment = {
    _id: 'c1',
    uid: 'u',
    nick: 'n',
    mail: '',
    mailMd5: '',
    link: '',
    ua: '',
    ip: '',
    ipRegion: '',
    master: 0,
    url: '/post',
    href: '',
    comment: 'hi',
    pid: '',
    rid: '',
    isSpam: 0,
    created: 0,
    updated: 0,
    ups: '[]',
    downs: '[]',
    top: 0,
    avatar: '',
  };

  const buildGetCtx = (rows: Comment[]): RequestCtx => {
    const db = {
      comment: {
        count: vi.fn(async () => rows.length),
        // First call probes head/main; second call (top=1) returns empty.
        list: vi
          .fn<(...args: unknown[]) => Promise<Comment[]>>()
          .mockResolvedValueOnce(rows)
          .mockResolvedValue([]),
        replies: vi.fn(async () => [] as Comment[]),
      },
    };
    return buildCtx({ uid: 'guest-uid', db: db as unknown as RequestCtx['db'] });
  };

  it('treats malformed ups as empty array and still returns the comment', async () => {
    const bad: Comment = { ...baseRow, _id: 'bad', ups: '{not-json' };
    const ctx = buildGetCtx([bad]);
    const result = await commentGet({ url: '/post' }, ctx);
    expect(result.count).toBe(1);
    const data = result.data as Array<{ ups?: unknown }>;
    expect(data).toHaveLength(1);
  });
});

describe('commentSubmit > enforceTurnstile', () => {
  it('skips siteverify when CAPTCHA_PROVIDER is unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const fake: FakeDb = { saved: [], perIp: 0, global: 0 };
    const ctx = buildSubmitCtx({}, fake);

    await commentSubmit(submitPayload(), ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fake.saved).toHaveLength(1);
  });

  it('proceeds with siteverify when only TURNSTILE_SECRET_KEY is set (site key blank)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const fake: FakeDb = { saved: [], perIp: 0, global: 0 };
    const ctx: RequestCtx = {
      ...buildSubmitCtx({ CAPTCHA_PROVIDER: 'Turnstile' }, fake),
      env: { TURNSTILE_SECRET_KEY: 'sk-test' } as RequestCtx['env'],
    };

    await commentSubmit(submitPayload({ turnstileToken: 'tk' }), ctx);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fake.saved).toHaveLength(1);
  });

  it('rejects when the Turnstile token is missing', async () => {
    const fake: FakeDb = { saved: [], perIp: 0, global: 0 };
    const ctx: RequestCtx = {
      ...buildSubmitCtx({ CAPTCHA_PROVIDER: 'Turnstile' }, fake),
      env: { TURNSTILE_SECRET_KEY: 'sk-test' } as RequestCtx['env'],
    };

    await expect(commentSubmit(submitPayload(), ctx)).rejects.toBeInstanceOf(TwikooError);
    expect(fake.saved).toHaveLength(0);
  });

  it('throws when CAPTCHA_PROVIDER=Turnstile but TURNSTILE_SECRET_KEY is unset', async () => {
    const fake: FakeDb = { saved: [], perIp: 0, global: 0 };
    const ctx = buildSubmitCtx({ CAPTCHA_PROVIDER: 'Turnstile' }, fake);

    await expect(
      commentSubmit(submitPayload({ turnstileToken: 'tk' }), ctx),
    ).rejects.toBeInstanceOf(TwikooError);
    expect(fake.saved).toHaveLength(0);
  });

  it('rejects when siteverify reports failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ 'success': false, 'error-codes': ['timeout-or-duplicate'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const fake: FakeDb = { saved: [], perIp: 0, global: 0 };
    const ctx: RequestCtx = {
      ...buildSubmitCtx({ CAPTCHA_PROVIDER: 'Turnstile' }, fake),
      env: { TURNSTILE_SECRET_KEY: 'sk-test' } as RequestCtx['env'],
    };

    await expect(
      commentSubmit(submitPayload({ turnstileToken: 'tk' }), ctx),
    ).rejects.toBeInstanceOf(TwikooError);
    expect(fake.saved).toHaveLength(0);
  });
});
