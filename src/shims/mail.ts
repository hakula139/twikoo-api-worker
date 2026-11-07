// Use HTTP providers because Workers cannot deliver SMTP mail.

import type { TwikooConfig } from '@/types';

import { AsyncLocalStorage } from 'node:async_hooks';

import { stringConfig } from '@/lib/config-read';

interface MailAuth {
  user?: string;
  pass?: string;
}

interface MailTransportConfig {
  service?: string;
  auth?: MailAuth;
}

interface MailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
}

interface MailTransport {
  verify(): true;
  sendMail(msg: MailMessage): Promise<Response>;
}

interface NodemailerShim {
  createTransport(config: unknown): MailTransport;
}

const SUPPORTED_SERVICES = ['sendgrid', 'mailchannels', 'resend'] as const;
type Service = (typeof SUPPORTED_SERVICES)[number];

const isSupportedService = (s: string): s is Service =>
  (SUPPORTED_SERVICES as readonly string[]).includes(s);

// Cached transports must resolve credentials in the active async context.
const mailConfig = new AsyncLocalStorage<MailTransportConfig>();

export const withMailConfig = <T>(config: TwikooConfig, operation: () => Promise<T>): Promise<T> =>
  mailConfig.run(
    {
      service: stringConfig(config, 'SMTP_SERVICE'),
      auth: {
        user: stringConfig(config, 'SMTP_USER'),
        pass: stringConfig(config, 'SMTP_PASS'),
      },
    },
    operation,
  );

const resolveConfig = (fallback: MailTransportConfig): { service: Service; apiKey: string } => {
  const config = mailConfig.getStore() ?? fallback;
  const service = config.service?.toLowerCase() ?? '';

  if (!isSupportedService(service)) {
    throw new Error('Only SendGrid, MailChannels, and Resend are supported.');
  }

  if (!config.auth?.user) {
    throw new Error('SMTP_USER must be set to any non-empty string.');
  }

  if (!config.auth.pass) {
    throw new Error('SMTP_PASS must be set with the provider API key.');
  }

  return { service, apiKey: config.auth.pass };
};

interface MailProvider {
  url: string;
  headers(apiKey: string): Record<string, string>;
  body(msg: MailMessage): unknown;
}

const parseMailbox = (mailbox: string): { email: string; name?: string } => {
  const match = mailbox.match(/^(.+)\s+<([^<>]+)>$/);

  if (!match) {
    return { email: mailbox };
  }

  const name = match[1].trim();

  return {
    email: match[2],
    name: name.startsWith('"') && name.endsWith('"') ? name.slice(1, -1) : name,
  };
};

const PROVIDERS: Record<Service, MailProvider> = {
  sendgrid: {
    url: 'https://api.sendgrid.com/v3/mail/send',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (msg) => ({
      personalizations: [{ to: [{ email: msg.to }] }],
      from: parseMailbox(msg.from),
      subject: msg.subject,
      content: [{ type: 'text/html', value: msg.html }],
    }),
  },
  mailchannels: {
    url: 'https://api.mailchannels.net/tx/v1/send',
    headers: (apiKey) => ({
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }),
    body: (msg) => ({
      personalizations: [{ to: [{ email: msg.to }] }],
      from: parseMailbox(msg.from),
      subject: msg.subject,
      content: [{ type: 'text/html', value: msg.html }],
    }),
  },
  resend: {
    url: 'https://api.resend.com/emails',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'twikoo-api-worker',
    }),
    body: (msg) => ({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
    }),
  },
};

// EMAIL_TEST requires rejected provider responses to throw.
const send = async (service: Service, apiKey: string, msg: MailMessage): Promise<Response> => {
  const provider = PROVIDERS[service];
  const response = await fetch(provider.url, {
    method: 'POST',
    headers: provider.headers(apiKey),
    body: JSON.stringify(provider.body(msg)),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const detail = text || response.statusText;
    throw new Error(`${service} send failed: ${response.status} ${detail}`);
  }

  return response;
};

export const mailShim: NodemailerShim = {
  createTransport(rawConfig) {
    const config = rawConfig as MailTransportConfig;
    return {
      verify(): true {
        resolveConfig(config);

        return true;
      },
      async sendMail(msg) {
        const { service, apiKey } = resolveConfig(config);

        return send(service, apiKey, msg);
      },
    };
  },
};
