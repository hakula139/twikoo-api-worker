import { afterEach, describe, expect, it, vi } from 'vitest';

import { mailShim } from '@/shims/mail';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mailShim', () => {
  it('sends Resend requests with the required headers and payload', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const transport = mailShim.createTransport({
      service: 'resend',
      auth: { user: 'resend', pass: 'api-key' },
    });

    expect(transport.verify()).toBe(true);
    await transport.sendMail({
      from: 'Hakula Blog <comments@notify.hakula.xyz>',
      to: 'reader@example.com',
      subject: 'New reply',
      html: '<p>Hello</p>',
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(url).toBe('https://api.resend.com/emails');
    expect(headers.get('Authorization')).toBe('Bearer api-key');
    expect(headers.get('User-Agent')).toBe('twikoo-api-worker');
    if (typeof init?.body !== 'string') {
      throw new Error('expected a JSON request body');
    }
    expect(JSON.parse(init.body)).toEqual({
      from: 'Hakula Blog <comments@notify.hakula.xyz>',
      to: 'reader@example.com',
      subject: 'New reply',
      html: '<p>Hello</p>',
    });
  });
});
