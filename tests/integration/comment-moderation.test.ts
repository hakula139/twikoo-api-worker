import type { EventPayloads, RequestCtx, TwikooConfig } from '@/types';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildComment } from '@/lib/comment-build';
import { logger } from '@/twikoo';
import { buildCtx } from '@tests/helpers/ctx';

vi.unmock('@/twikoo');

const payload = (nick?: string): EventPayloads['COMMENT_SUBMIT'] => ({
  url: '/post/',
  ua: 'Mozilla/5.0',
  comment: 'A comment.',
  nick,
});

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('integration: comment moderation', () => {
  it.each([
    { nick: undefined, filter: 'BLOCKED_WORDS' },
    { nick: '', filter: 'BLOCKED_WORDS' },
    { nick: undefined, filter: 'FORBIDDEN_WORDS' },
    { nick: '', filter: 'FORBIDDEN_WORDS' },
  ])('accepts anonymous nickname $nick with $filter enabled', async ({ nick, filter }) => {
    const ctx = buildCtx({ config: { [filter]: 'unmatched-word' } });

    const row = await buildComment(payload(nick), ctx);

    expect(row.nick).toBe('匿名');
    expect(row.isSpam).toBe(0);
  });

  it.each([undefined, ''])(
    'rejects default nickname %s when it matches a blocked word',
    async (nick) => {
      const ctx = buildCtx({ config: { BLOCKED_WORDS: '匿名' } });

      await expect(buildComment(payload(nick), ctx)).rejects.toThrow('包含屏蔽词');
    },
  );

  it.each([undefined, ''])(
    'moderates default nickname %s when it matches a forbidden word',
    async (nick) => {
      const ctx = buildCtx({ config: { FORBIDDEN_WORDS: '匿名' } });

      const row = await buildComment(payload(nick), ctx);

      expect(row.isSpam).toBe(1);
    },
  );

  it.each<{
    name: string;
    config: TwikooConfig;
    env: Partial<RequestCtx['env']>;
    isSpam: number;
  }>([
    {
      name: 'environment manual review',
      config: {},
      env: { AKISMET_KEY: 'MANUAL_REVIEW' },
      isSpam: 1,
    },
    { name: 'stored manual review', config: { AKISMET_KEY: 'MANUAL_REVIEW' }, env: {}, isSpam: 1 },
    {
      name: 'environment key overriding stored manual review',
      config: { AKISMET_KEY: 'MANUAL_REVIEW' },
      env: { AKISMET_KEY: 'example-key' },
      isSpam: 0,
    },
  ])('honors $name', async ({ config, env, isSpam }) => {
    const ctx = buildCtx({ config, env: env as RequestCtx['env'] });

    const row = await buildComment(payload('Reader'), ctx);

    expect(row.isSpam).toBe(isSpam);
  });
});
