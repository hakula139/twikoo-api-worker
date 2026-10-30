import type { RequestCtx } from '@/types';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { postSubmit } from '@/lib/comment-post-submit';
import { logger } from '@/twikoo';
import { mkCommentId } from '@/types';
import { newComment } from '@tests/helpers/comment-fixture';
import { buildCtx } from '@tests/helpers/ctx';

vi.unmock('@/twikoo');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('integration: notifications', () => {
  it.each([
    { name: 'no push configuration', config: {}, masterEmail: true, telegram: false },
    {
      name: 'push channel without a token',
      config: { PUSHOO_CHANNEL: 'telegram' },
      masterEmail: true,
      telegram: false,
    },
    {
      name: 'push token without a channel',
      config: { PUSHOO_TOKEN: '123456:example_token#-100123456' },
      masterEmail: true,
      telegram: false,
    },
    {
      name: 'Telegram with default master-email suppression',
      config: { PUSHOO_CHANNEL: 'telegram', PUSHOO_TOKEN: '123456:example_token#-100123456' },
      masterEmail: false,
      telegram: true,
    },
    {
      name: 'Telegram with master email enabled',
      config: {
        PUSHOO_CHANNEL: 'telegram',
        PUSHOO_TOKEN: '123456:example_token#-100123456',
        SC_MAIL_NOTIFY: 'true',
      },
      masterEmail: true,
      telegram: true,
    },
    {
      name: 'unsupported push channel',
      config: { PUSHOO_CHANNEL: 'bark', PUSHOO_TOKEN: 'example-token' },
      masterEmail: false,
      telegram: false,
    },
  ])('delivers the configured notices for $name', async ({ config, masterEmail, telegram }) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const parent = newComment({
      _id: mkCommentId('parent-1'),
      mail: 'parent@example.com',
      nick: 'Parent',
      url: '/post/',
      href: 'https://example.com/post/',
    });
    const saved = newComment({
      _id: mkCommentId('reply-1'),
      mail: 'reader@example.com',
      pid: parent._id,
      url: '/post/',
      href: 'https://example.com/post/',
    });
    const ctx = buildCtx({
      request: new Request('https://comments.example.com/'),
      env: {
        SENDER_EMAIL: 'comments@example.com',
        SMTP_PASS: 'example-api-key',
        SMTP_USER: 'resend',
      } as RequestCtx['env'],
      config: {
        BLOGGER_EMAIL: 'owner@example.com',
        SENDER_NAME: 'Example Site',
        SITE_NAME: 'Example Site',
        SITE_URL: 'https://example.com/',
        SMTP_SERVICE: 'resend',
        ...config,
      },
      db: {
        comment: { byId: vi.fn(async (id: string) => (id === parent._id ? parent : undefined)) },
      } as unknown as RequestCtx['db'],
    });

    await postSubmit(saved, ctx);

    const requests = fetchMock.mock.calls.map(([url, init]) => ({
      url: url as string,
      body: JSON.parse(init?.body as string) as Record<string, unknown>,
    }));
    const emails = requests.filter(({ url }) => url === 'https://api.resend.com/emails');
    const recipients = masterEmail
      ? ['owner@example.com', 'parent@example.com']
      : ['parent@example.com'];
    expect(emails.map(({ body }) => body.to).sort()).toEqual(recipients);
    for (const { body } of emails) {
      expect(body.from).toBe('"Example Site" <comments@example.com>');
      expect(body.html).toContain('href="https://example.com/post/#reply-1"');
    }
    expect(requests.map(({ url }) => url).sort()).toEqual(
      [
        ...recipients.map(() => 'https://api.resend.com/emails'),
        ...(telegram ? ['https://api.telegram.org/bot123456:example_token/sendMessage'] : []),
      ].sort(),
    );
    if (telegram) {
      const message = requests.find(({ url }) => url.includes('api.telegram.org'))?.body;
      expect(message).toMatchObject({ chat_id: '-100123456', parse_mode: 'HTML' });
      expect(message?.text).toContain('href="https://example.com/post/#reply-1"');
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
