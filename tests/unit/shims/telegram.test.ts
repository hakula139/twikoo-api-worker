import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendTelegramNotice } from '@/shims/telegram';

const comment = {
  _id: 'comment-1',
  nick: 'Alice <admin>',
  mail: 'alice@example.com',
  ip: '192.0.2.1',
  comment: '<p>Hello &amp; <strong>world</strong></p>',
  url: '/post',
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

    await sendTelegramNotice(comment, config, config.PUSHOO_TOKEN);

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

  it('surfaces Telegram API failures returned with HTTP 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ok: false, description: 'invalid chat' }),
    );

    await expect(sendTelegramNotice(comment, config, config.PUSHOO_TOKEN)).rejects.toThrow(
      'Telegram send failed: 200 invalid chat',
    );
  });

  it.each(['token', '#chat', 'token#'])('rejects incomplete token %s', async (pushToken) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(sendTelegramNotice(comment, config, pushToken)).rejects.toThrow(
      'PUSHOO_TOKEN must contain a Telegram bot token and chat ID separated by #.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits the article link when the site URL is not configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await sendTelegramNotice(comment, { ...config, SITE_URL: undefined }, config.PUSHOO_TOKEN);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).not.toContain('<a href=');
  });

  it.each(['not a URL', 'ftp://blog.example/', 'file:///tmp/'])(
    'omits the article link for site URL %s',
    async (siteUrl) => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json({ ok: true }));

      await sendTelegramNotice(comment, { ...config, SITE_URL: siteUrl }, config.PUSHOO_TOKEN);

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(init.body as string) as { text: string };
      expect(body.text).not.toContain('<a href=');
    },
  );

  it('rejects links that escape the configured site origin', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await sendTelegramNotice(
      { ...comment, url: String.raw`\evil.example/post` },
      { ...config, SITE_URL: 'https://safe.example/' },
      config.PUSHOO_TOKEN,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).not.toContain('<a href=');
  });

  it('omits the article link for an invalid comment path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await sendTelegramNotice({ ...comment, url: String.raw`\[` }, config, config.PUSHOO_TOKEN);

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
        mail: `mail-${hostile.repeat(200)}`,
        ip: `ip-${hostile.repeat(100)}`,
        comment: `<p>${'😀'.repeat(1_500)}</p>`,
        url: `/post?quote="&tag=<x>`,
      },
      {
        ...config,
        MAIL_SUBJECT_ADMIN: '😀'.repeat(500),
        SITE_URL: 'https://safe.example/base/',
      },
      config.PUSHOO_TOKEN,
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
    expect(body.text).toContain('<code>mail-&amp;&lt;&gt;&quot;&#39;');
    expect(body.text).toContain('</code> · <code>ip-&amp;&lt;&gt;&quot;&#39;');
  });
});
