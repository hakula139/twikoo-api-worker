// Nodemailer-shape shim. `nodemailer` is null'd at bundle time (Node-only SMTP);
// we route through HTTP providers instead.

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

interface MailProvider {
  url: string;
  headers(apiKey: string): Record<string, string>;
  body(msg: MailMessage): unknown;
}

const PROVIDERS: Record<Service, MailProvider> = {
  sendgrid: {
    url: 'https://api.sendgrid.com/v3/mail/send',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (msg) => ({
      personalizations: [{ to: [{ email: msg.to }] }],
      from: { email: msg.from },
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
      from: { email: msg.from },
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
    }),
    body: (msg) => ({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
    }),
  },
};

// Provider returns 2xx on accepted, 4xx/5xx on rejected. EMAIL_TEST relies on
// failures throwing; otherwise the caller stores the failure Response as
// "sent" and the misconfiguration goes unnoticed.
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
    const service = config.service?.toLowerCase() ?? '';
    return {
      verify(): true {
        if (!isSupportedService(service)) {
          throw new Error('Only SendGrid, MailChannels, and Resend are supported.');
        }
        if (!config.auth?.user) {
          throw new Error('SMTP_USER must be set (any non-empty string for SendGrid).');
        }
        if (!config.auth.pass) {
          throw new Error('SMTP_PASS must be set with the provider API key.');
        }
        return true;
      },
      async sendMail(msg) {
        if (!isSupportedService(service)) {
          throw new Error(`Unsupported mail service: ${config.service ?? '<unset>'}`);
        }
        return send(service, config.auth?.pass ?? '', msg);
      },
    };
  },
};
