import type { Comment, NewComment } from '@/db';
import type { JsonString, RequestCtx, TwikooConfig } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { commentGet, commentSubmit } from '@/handlers/comment';
import { TwikooError } from '@/lib/errors';
import { mkCommentId, mkIp, mkUid } from '@/types';
import { buildCtx } from '../../helpers/ctx';

interface FakeDb {
  saved: NewComment[];
  perIp: number;
  global: number;
}

const buildSubmitCtx = (config: TwikooConfig, fake: FakeDb): RequestCtx => {
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
  return buildCtx({
    ip: mkIp('1.2.3.4'),
    uid: mkUid('guest-uid'),
    config,
    db: db as unknown as RequestCtx['db'],
  });
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

// Boundary cases for the guards live in tests/unit/lib/{rate-limit,captcha-guard}.
// These integration smokes pin the wiring: commentSubmit invokes the guards
// before save and the build step before save.
describe('commentSubmit', () => {
  it('saves a row when no guards reject', async () => {
    const fake: FakeDb = { saved: [], perIp: 0, global: 0 };
    const ctx = buildSubmitCtx({}, fake);

    const result = await commentSubmit(submitPayload(), ctx);

    expect(typeof result.id).toBe('string');
    expect(fake.saved).toHaveLength(1);
    expect(fake.saved[0]?._id).toBe(result.id);
  });

  it('does not save when the per-IP frequency cap is reached', async () => {
    const fake: FakeDb = { saved: [], perIp: 10, global: 0 };
    const ctx = buildSubmitCtx({}, fake);

    await expect(commentSubmit(submitPayload(), ctx)).rejects.toBeInstanceOf(TwikooError);
    expect(fake.saved).toHaveLength(0);
  });

  it('does not save when Turnstile is enabled but the token is missing', async () => {
    const fake: FakeDb = { saved: [], perIp: 0, global: 0 };
    const ctx: RequestCtx = {
      ...buildSubmitCtx({ CAPTCHA_PROVIDER: 'Turnstile' }, fake),
      env: { TURNSTILE_SECRET_KEY: 'sk-test' } as RequestCtx['env'],
    };

    await expect(commentSubmit(submitPayload(), ctx)).rejects.toBeInstanceOf(TwikooError);
    expect(fake.saved).toHaveLength(0);
  });
});

describe('commentGet > malformed votes JSON', () => {
  const baseRow: Comment = {
    _id: mkCommentId('c1'),
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
    ups: '[]' as JsonString<string[]>,
    downs: '[]' as JsonString<string[]>,
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
    return buildCtx({ uid: mkUid('guest-uid'), db: db as unknown as RequestCtx['db'] });
  };

  it('treats malformed ups as empty array and still returns the comment', async () => {
    const bad: Comment = {
      ...baseRow,
      _id: mkCommentId('bad'),
      ups: '{not-json' as JsonString<string[]>,
    };
    const ctx = buildGetCtx([bad]);
    const result = await commentGet({ url: '/post' }, ctx);
    expect(result.count).toBe(1);
    const data = result.data as Array<{ ups?: unknown }>;
    expect(data).toHaveLength(1);
  });
});
