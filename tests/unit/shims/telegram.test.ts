import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendTelegramNotice } from '@/shims/telegram';
import * as twikoo from '@/twikoo';

const comment = {
  _id: 'comment-1',
  nick: 'Alice <Admin>',
  mail: 'alice@example.com',
  ip: '192.0.2.1',
  comment: '<p>Research &amp; <strong>development</strong>.</p>',
  url: '/about-me/',
};

const config = {
  PUSHOO_CHANNEL: 'telegram',
  PUSHOO_TOKEN: '123456:bot_token#-100123456',
  SITE_NAME: 'HAKULA†CHANNEL',
  SITE_URL: 'https://hakula.xyz/',
};

const sentText = (fetchMock: MockInstance): string => {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return (JSON.parse(init.body as string) as { text: string }).text;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(twikoo.htmlToText).mockReturnValue('Research & development.');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendTelegramNotice', () => {
  it('sends an escaped HTML notification to the configured chat', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await sendTelegramNotice(comment, config, config.PUSHOO_TOKEN);

    const expectedText = `
<b>您在 HAKULA†CHANNEL 发表的文章有了新评论～</b>

<b>Alice &lt;Admin&gt;</b>
<blockquote>Research &amp; development.</blockquote>

<a href="https://hakula.xyz/about-me/#comment-1">查看原文</a>

<code>alice@example.com</code> · <code>192.0.2.1</code>`.trim();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(twikoo.htmlToText).toHaveBeenCalledWith(comment.comment);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123456:bot_token/sendMessage');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(init.body as string)).toEqual({
      text: expectedText,
      chat_id: '-100123456',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });

  it('surfaces Telegram API failures returned with HTTP 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ok: false, description: 'invalid chat' }),
    );

    await expect(sendTelegramNotice(comment, config, config.PUSHOO_TOKEN)).rejects.toThrow(
      'Telegram send failed: 200 invalid chat',
    );
  });

  it('uses the HTTP status when Telegram omits an error description', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ok: false }, { status: 400, statusText: 'Bad Request' }),
    );

    await expect(sendTelegramNotice(comment, config, config.PUSHOO_TOKEN)).rejects.toThrow(
      'Telegram send failed: 400 Bad Request',
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

    expect(sentText(fetchMock)).not.toContain('<a href=');
  });

  it.each(['not a URL', 'ftp://hakula.xyz/', 'file:///tmp/'])(
    'omits the article link for site URL %s',
    async (siteUrl) => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json({ ok: true }));

      await sendTelegramNotice(comment, { ...config, SITE_URL: siteUrl }, config.PUSHOO_TOKEN);

      expect(sentText(fetchMock)).not.toContain('<a href=');
    },
  );

  it('rejects links that escape the configured site origin', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await sendTelegramNotice(
      { ...comment, url: String.raw`\evil.example/post` },
      { ...config, SITE_URL: 'https://safe.example/' },
      config.PUSHOO_TOKEN,
    );

    expect(sentText(fetchMock)).not.toContain('<a href=');
  });

  it('omits the article link for an invalid comment path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await sendTelegramNotice({ ...comment, url: String.raw`\[` }, config, config.PUSHOO_TOKEN);

    expect(sentText(fetchMock)).not.toContain('<a href=');
  });

  it('replaces an existing article fragment with the comment anchor', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await sendTelegramNotice(
      { ...comment, url: '/about-me/#old-anchor' },
      config,
      config.PUSHOO_TOKEN,
    );

    expect(sentText(fetchMock)).toContain(
      '<a href="https://hakula.xyz/about-me/#comment-1">查看原文</a>',
    );
    expect(sentText(fetchMock)).not.toContain('old-anchor');
  });

  it('omits an article link that exceeds the message budget', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await sendTelegramNotice(
      { ...comment, url: `/${'x'.repeat(900)}` },
      config,
      config.PUSHOO_TOKEN,
    );

    expect(sentText(fetchMock)).not.toContain('<a href=');
  });

  it('omits an article link whose HTML escaping exceeds the message budget', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    const url = `/about-me/?${'topic=research&'.repeat(45)}`;
    expect(url.length).toBeLessThan(800);

    await sendTelegramNotice({ ...comment, url }, config, config.PUSHOO_TOKEN);

    expect(sentText(fetchMock)).not.toContain('<a href=');
  });

  it('uses a clean default title without a site name', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await sendTelegramNotice(comment, { ...config, SITE_NAME: undefined }, config.PUSHOO_TOKEN);

    expect(sentText(fetchMock)).toMatch(/^<b>您的文章有了新评论～<\/b>/);
  });

  it('bounds Unicode fields and uses the configured site URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    const hostile = `&<>"'`;
    vi.mocked(twikoo.htmlToText).mockReturnValueOnce(`Long comment ${'😀'.repeat(1_500)}`);

    await sendTelegramNotice(
      {
        ...comment,
        nick: `Alice ${'😀'.repeat(300)}`,
        mail: `alice+${hostile.repeat(200)}@example.com`,
        ip: `192.0.2.1${hostile.repeat(100)}`,
        comment: `<p>Long comment ${'😀'.repeat(1_500)}</p>`,
        url: `/about-me/?quote="&tag=<x>`,
      },
      {
        ...config,
        SITE_NAME: `HAKULA†CHANNEL <${'😀'.repeat(500)}>`,
        SITE_URL: 'https://safe.example/base/',
      },
      config.PUSHOO_TOKEN,
    );

    const text = sentText(fetchMock);
    expect(text.length).toBeLessThanOrEqual(4_096);
    expect(
      [...text].some((char) => {
        const point = char.codePointAt(0) ?? 0;
        return point >= 0xd800 && point <= 0xdfff;
      }),
    ).toBe(false);
    expect(text).toMatch(/^<b>您在 HAKULA†CHANNEL &lt;😀/);
    expect(text).toMatch(/<b>Alice 😀+\.\.\.<\/b>/u);
    expect(text).toMatch(/<blockquote>Long comment 😀+\.\.\.<\/blockquote>/u);
    expect(text).toContain(
      '<a href="https://safe.example/about-me/?quote=%22&amp;tag=%3Cx%3E#comment-1">查看原文</a>',
    );
    expect(text).toContain('<code>alice+&amp;&lt;&gt;&quot;&#39;');
    expect(text).toContain('</code> · <code>192.0.2.1&amp;&lt;&gt;&quot;&#39;');
  });
});
