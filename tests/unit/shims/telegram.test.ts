import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendTelegramNotice } from '@/shims/telegram';

const comment = {
  _id: 'comment-1',
  nick: 'Alice <admin>',
  mail: 'alice@example.com',
  ip: '192.0.2.1',
  comment: '<p>Hello &amp; <strong>world</strong></p>',
  href: 'https://blog.example/post#old',
  url: '/post',
  isSpam: 0,
};

const config = {
  PUSHOO_CHANNEL: 'telegram',
  PUSHOO_TOKEN: '123456:bot_token#-100123456',
  SITE_NAME: 'Hakula & Blog',
  SITE_URL: 'https://blog.example/',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendTelegramNotice', () => {
  it('sends an escaped HTML notification to the configured chat', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await sendTelegramNotice(comment, config);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/bot123456:bot_token/sendMessage',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `<b>Hakula &amp; Blog有新评论了</b>

<b>Alice &lt;admin&gt;</b>
<blockquote>Hello &amp; world</blockquote>

<a href="https://blog.example/post#comment-1">查看原文</a>

<code>alice@example.com</code> · <code>192.0.2.1</code>`,
          chat_id: '-100123456',
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        }),
      },
    );
  });

  it('skips notifications for the blogger or excluded spam', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await sendTelegramNotice(comment, { ...config, BLOGGER_EMAIL: ' ALICE@example.com ' });
    await sendTelegramNotice({ ...comment, isSpam: 1 }, { ...config, NOTIFY_SPAM: 'false' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces Telegram API failures returned with HTTP 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ok: false, description: 'invalid chat' }),
    );

    await expect(sendTelegramNotice(comment, config)).rejects.toThrow(
      'Telegram send failed: 200 invalid chat',
    );
  });

  it('rejects an unreadable Telegram response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json'));

    await expect(sendTelegramNotice(comment, config)).rejects.toThrow(
      'Telegram send failed: 200 Invalid response',
    );
  });

  it('requires a configured site URL and sends spam unless explicitly disabled', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await sendTelegramNotice(
      { ...comment, isSpam: 1 },
      { ...config, NOTIFY_SPAM: 'true', SITE_URL: undefined },
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).not.toContain('<a href=');
  });

  it('rejects links that escape the configured site origin', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await sendTelegramNotice(
      { ...comment, url: String.raw`\evil.example/post` },
      { ...config, SITE_URL: 'https://safe.example/' },
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).not.toContain('<a href=');
  });

  it('bounds Unicode fields and uses the configured site URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    const hostile = `&<>"'`;

    await sendTelegramNotice(
      {
        ...comment,
        nick: '😀'.repeat(300),
        mail: hostile.repeat(200),
        ip: hostile.repeat(100),
        comment: `<p>${'😀'.repeat(1_500)}</p>`,
        href: 'javascript:alert(1)',
        url: `/post?quote="&tag=<x>`,
      },
      {
        ...config,
        MAIL_SUBJECT_ADMIN: '😀'.repeat(500),
        SITE_URL: 'https://safe.example/base/',
      },
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text.length).toBeLessThanOrEqual(4_096);
    expect(
      [...body.text].some((char) => {
        const point = char.codePointAt(0) ?? 0;
        return point >= 0xd800 && point <= 0xdfff;
      }),
    ).toBe(false);
    expect(body.text).toContain('<a href="https://safe.example/post?');
    expect(body.text).not.toContain('javascript:');
    expect(body.text).toContain('&amp;&lt;&gt;&quot;&#39;');
  });
});
