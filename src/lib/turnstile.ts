// Cloudflare Turnstile siteverify; replaces twikoo-func's axios-based path.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface SiteverifyResponse {
  'success': boolean;
  'error-codes'?: string[];
}

export interface TurnstileResult {
  success: boolean;
  errorCodes: string[];
}

export const verifyTurnstile = async (opts: {
  secret: string;
  token: string;
  ip?: string;
}): Promise<TurnstileResult> => {
  const body = new URLSearchParams({ secret: opts.secret, response: opts.token });
  if (opts.ip) {
    body.set('remoteip', opts.ip);
  }

  const response = await fetch(SITEVERIFY_URL, { method: 'POST', body });
  if (!response.ok) {
    return { success: false, errorCodes: [`http-${response.status}`] };
  }

  const data = await response.json<SiteverifyResponse>();
  return { success: data.success, errorCodes: data['error-codes'] ?? [] };
};
