import type { Handler } from '@/types';

import { secret } from '@/lib/secret';
import { logger, validate } from '@/twikoo';

const QQ_NICK_API = 'https://v1.nsuuu.com/api/qqname';

interface QqNickResponse {
  code?: number;
  data?: { nick?: string };
}

export const getQqNick: Handler<'GET_QQ_NICK'> = async (payload, ctx) => {
  validate(payload, ['qq']);

  const qq = payload.qq.replace(/@qq\.com$/i, '');
  const apiKey = secret(ctx, 'QQ_API_KEY');

  const nick = await fetchQqNick(qq, apiKey);
  return { nick };
};

// Best-effort lookup: any failure (network, non-200, malformed body) returns
// null so the widget falls back to letting the user type their own nickname.
const fetchQqNick = async (qq: string, apiKey?: string): Promise<string | null> => {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(`${QQ_NICK_API}?qq=${encodeURIComponent(qq)}`, { headers });
    if (!response.ok) {
      return null;
    }
    const data = await response.json<QqNickResponse>();
    return data.code === 200 && data.data?.nick ? data.data.nick : null;
  } catch (error) {
    logger.warn('Failed to fetch QQ nick:', error);
    return null;
  }
};
