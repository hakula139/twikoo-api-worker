import { afterEach, describe, expect, it, vi } from 'vitest';

import { mailShim } from '@/shims/mail';

const message = {
  from: '"HAKULA†CHANNEL" <comments@notify.hakula.xyz>',
  to: 'reader@example.com',
  subject: '您的评论有了新回复',
  html: '<p>感谢您的评论。</p>',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mailShim', () => {
  it.each([
    {
      service: 'sendgrid',
      url: 'https://api.sendgrid.com/v3/mail/send',
      headers: {
        'Authorization': 'Bearer test-api-key',
        'Content-Type': 'application/json',
      },
      body: {
        personalizations: [{ to: [{ email: 'reader@example.com' }] }],
        from: { email: 'comments@notify.hakula.xyz', name: 'HAKULA†CHANNEL' },
        subject: '您的评论有了新回复',
        content: [{ type: 'text/html', value: '<p>感谢您的评论。</p>' }],
      },
    },
    {
      service: 'mailchannels',
      url: 'https://api.mailchannels.net/tx/v1/send',
      headers: {
        'X-Api-Key': 'test-api-key',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: {
        personalizations: [{ to: [{ email: 'reader@example.com' }] }],
        from: { email: 'comments@notify.hakula.xyz', name: 'HAKULA†CHANNEL' },
        subject: '您的评论有了新回复',
        content: [{ type: 'text/html', value: '<p>感谢您的评论。</p>' }],
      },
    },
    {
      service: 'resend',
      url: 'https://api.resend.com/emails',
      headers: {
        'Authorization': 'Bearer test-api-key',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'twikoo-api-worker',
      },
      body: {
        from: '"HAKULA†CHANNEL" <comments@notify.hakula.xyz>',
        to: 'reader@example.com',
        subject: '您的评论有了新回复',
        html: '<p>感谢您的评论。</p>',
      },
    },
  ])('sends a valid $service request', async ({ service, url, headers, body }) => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const transport = mailShim.createTransport({
      service,
      auth: { user: service, pass: 'test-api-key' },
    });

    expect(transport.verify()).toBe(true);
    await transport.sendMail(message);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [requestUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe(url);
    const requestHeaders = new Headers(init.headers);
    for (const [name, value] of Object.entries(headers)) {
      expect(requestHeaders.get(name)).toBe(value);
    }
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it.each(['sendgrid', 'mailchannels'])('accepts a bare sender address for %s', async (service) => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const transport = mailShim.createTransport({
      service,
      auth: { user: service, pass: 'test-api-key' },
    });

    await transport.sendMail({ ...message, from: 'comments@notify.hakula.xyz' });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as { from: unknown };
    expect(body.from).toEqual({ email: 'comments@notify.hakula.xyz' });
  });

  it.each([
    [{ service: 'smtp', auth: { user: 'smtp', pass: 'test-api-key' } }, /Only SendGrid/],
    [{ service: 'resend', auth: { pass: 'test-api-key' } }, /SMTP_USER/],
    [{ service: 'resend', auth: { user: 'resend' } }, /SMTP_PASS/],
  ])('rejects invalid transport configuration', (config, expected) => {
    expect(() => mailShim.createTransport(config).verify()).toThrow(expected);
  });

  it('throws when a provider rejects the message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('domain is not verified', { status: 403, statusText: 'Forbidden' }),
    );
    const transport = mailShim.createTransport({
      service: 'resend',
      auth: { user: 'resend', pass: 'test-api-key' },
    });

    await expect(transport.sendMail(message)).rejects.toThrow(
      'resend send failed: 403 domain is not verified',
    );
  });
});
