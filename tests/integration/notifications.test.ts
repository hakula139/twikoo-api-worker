import type { Comment } from '@/db';
import type { RequestCtx, TwikooConfig } from '@/types';
import type { MockInstance } from 'vitest';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emailTest } from '@/handlers/mail';
import { postSubmit } from '@/lib/comment-post-submit';
import { EMPTY_STRING_ARRAY_JSON } from '@/lib/json-string';
import { logger, md5 } from '@/twikoo';
import { mkCommentId, mkUid } from '@/types';
import { newComment } from '@tests/helpers/comment-fixture';
import { buildCtx } from '@tests/helpers/ctx';

vi.unmock('@/twikoo');

let errorSpy: MockInstance;

beforeEach(() => {
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  vi.spyOn(logger, 'log').mockImplementation(() => undefined);
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const notification = (config: TwikooConfig = {}, env: Partial<RequestCtx['env']> = {}) => {
  const parent: Comment = {
    ...newComment({
      _id: mkCommentId('parent-1'),
      mail: 'parent@example.com',
      nick: 'Parent',
      url: '/post/',
      href: 'https://example.com/post/',
    }),
    ipRegion: '',
    ups: EMPTY_STRING_ARRAY_JSON,
    downs: EMPTY_STRING_ARRAY_JSON,
  };
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
      ...env,
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

  return { parent, saved, ctx };
};

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
    const { saved, ctx } = notification(config);

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

  it('uses the current provider and credentials after configuration changes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    const first = notification({ SMTP_SERVICE: 'resend' }, { SMTP_PASS: 'first-api-key' });
    const second = notification({ SMTP_SERVICE: 'sendgrid' }, { SMTP_PASS: 'second-api-key' });

    await postSubmit(first.saved, first.ctx);
    await postSubmit(second.saved, second.ctx);

    expect(
      fetchMock.mock.calls.map(([url, init]) => [
        url,
        new Headers(init?.headers).get('Authorization'),
      ]),
    ).toEqual([
      ['https://api.resend.com/emails', 'Bearer first-api-key'],
      ['https://api.resend.com/emails', 'Bearer first-api-key'],
      ['https://api.sendgrid.com/v3/mail/send', 'Bearer second-api-key'],
      ['https://api.sendgrid.com/v3/mail/send', 'Bearer second-api-key'],
    ]);
  });

  it('retains each notification context while parent lookups overlap', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    const first = notification({ SMTP_SERVICE: 'resend' }, { SMTP_PASS: 'first-api-key' });
    const second = notification({ SMTP_SERVICE: 'sendgrid' }, { SMTP_PASS: 'second-api-key' });
    const parentReady = Promise.withResolvers<Comment>();
    const lookupStarted = Promise.withResolvers<void>();
    vi.spyOn(first.ctx.db.comment, 'byId').mockImplementationOnce(() => {
      lookupStarted.resolve();
      return parentReady.promise;
    });

    const pending = postSubmit(first.saved, first.ctx);
    await lookupStarted.promise;
    await postSubmit(second.saved, second.ctx);
    parentReady.resolve(first.parent);
    await pending;

    expect(
      fetchMock.mock.calls.map(([url, init]) => [
        url,
        new Headers(init?.headers).get('Authorization'),
      ]),
    ).toEqual([
      ['https://api.resend.com/emails', 'Bearer first-api-key'],
      ['https://api.sendgrid.com/v3/mail/send', 'Bearer second-api-key'],
      ['https://api.sendgrid.com/v3/mail/send', 'Bearer second-api-key'],
      ['https://api.resend.com/emails', 'Bearer first-api-key'],
    ]);
  });

  it('keeps Telegram independent when current mail credentials are missing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    const first = notification();
    await postSubmit(first.saved, first.ctx);
    fetchMock.mockClear();
    const next = notification(
      {
        PUSHOO_CHANNEL: 'telegram',
        PUSHOO_TOKEN: '123456:example_token#-100123456',
        SC_MAIL_NOTIFY: 'true',
      },
      { SMTP_PASS: undefined },
    );

    await postSubmit(next.saved, next.ctx);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.telegram.org/bot123456:example_token/sendMessage',
    ]);
  });

  it('preserves an in-flight reply when an invalid email test is rejected', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    const first = notification();
    const invalid = notification({}, { SMTP_PASS: undefined });
    invalid.ctx.uid = mkUid('example-admin');
    invalid.ctx.config.ADMIN_PASS = md5(invalid.ctx.uid);
    const parentReady = Promise.withResolvers<Comment>();
    const lookupStarted = Promise.withResolvers<void>();
    vi.spyOn(first.ctx.db.comment, 'byId').mockImplementationOnce(() => {
      lookupStarted.resolve();
      return parentReady.promise;
    });

    const pending = postSubmit(first.saved, first.ctx);
    await lookupStarted.promise;
    await expect(emailTest({ mail: 'test@example.com' }, invalid.ctx)).rejects.toThrow();
    parentReady.resolve(first.parent);
    await pending;

    const recipients = fetchMock.mock.calls.map(
      ([, init]) => (JSON.parse(init?.body as string) as { to: string }).to,
    );
    expect(recipients.sort()).toEqual(['owner@example.com', 'parent@example.com']);
  });
});
