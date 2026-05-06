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

export interface NodemailerShim {
  createTransport(config: unknown): MailTransport;
}

const SUPPORTED_SERVICES = ['sendgrid', 'mailchannels', 'resend'] as const;
type Service = (typeof SUPPORTED_SERVICES)[number];

const isSupportedService = (s: string): s is Service =>
  (SUPPORTED_SERVICES as readonly string[]).includes(s);

const sendViaSendgrid = (apiKey: string, msg: MailMessage): Promise<Response> =>
  fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: msg.to }] }],
      from: { email: msg.from },
      subject: msg.subject,
      content: [{ type: 'text/html', value: msg.html }],
    }),
  });

const sendViaMailchannels = (apiKey: string, msg: MailMessage): Promise<Response> =>
  fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: msg.to }] }],
      from: { email: msg.from },
      subject: msg.subject,
      content: [{ type: 'text/html', value: msg.html }],
    }),
  });

const sendViaResend = (apiKey: string, msg: MailMessage): Promise<Response> =>
  fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
    }),
  });

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
        const apiKey = config.auth?.pass ?? '';
        if (service === 'sendgrid') {
          return sendViaSendgrid(apiKey, msg);
        }
        if (service === 'mailchannels') {
          return sendViaMailchannels(apiKey, msg);
        }
        if (service === 'resend') {
          return sendViaResend(apiKey, msg);
        }
        throw new Error(`Unsupported mail service: ${config.service ?? '<unset>'}`);
      },
    };
  },
};
