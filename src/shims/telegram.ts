import type { TwikooConfig } from '@/types';

import { getHtmlToText } from 'twikoo-func/utils/lib';

import { stringConfig } from '@/lib/config-read';

interface TelegramComment {
  _id: string;
  nick: string;
  mail: string;
  ip: string;
  comment: string;
  href: string;
  url: string;
  isSpam: number;
}

const htmlToText = getHtmlToText();
const MAX_TITLE_LENGTH = 300;
const MAX_NICK_LENGTH = 240;
const MAX_COMMENT_LENGTH = 2_000;
const MAX_URL_LENGTH = 800;
const MAX_MAIL_LENGTH = 400;
const MAX_IP_LENGTH = 100;

const escapeChar = (char: string): string => {
  switch (char) {
    case '&':
      return '&amp;';
    case '<':
      return '&lt;';
    case '>':
      return '&gt;';
    case '"':
      return '&quot;';
    case "'":
      return '&#39;';
    default:
      return char;
  }
};

const escapeHtml = (value: string, maxLength: number): string => {
  let escaped = '';
  for (const char of value) {
    const next = escapeChar(char);
    if (escaped.length + next.length > maxLength - 3) {
      return `${escaped}...`;
    }
    escaped += next;
  }
  return escaped;
};

const commentUrl = (comment: TelegramComment, config: TwikooConfig): string | undefined => {
  try {
    const path = `/${comment.url.replace(/^\/+/, '')}`;
    const siteUrl = stringConfig(config, 'SITE_URL');
    if (!siteUrl) {
      return undefined;
    }
    const base = new URL(siteUrl);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') {
      return undefined;
    }
    const url = new URL(path, base);
    if (url.origin !== base.origin) {
      return undefined;
    }
    const hash = url.href.indexOf('#');
    const href = `${hash === -1 ? url.href : url.href.slice(0, hash)}#${comment._id}`;
    const escapedLength = [...href].reduce((length, char) => length + escapeChar(char).length, 0);
    return escapedLength <= MAX_URL_LENGTH ? escapeHtml(href, MAX_URL_LENGTH) : undefined;
  } catch {
    return undefined;
  }
};

const sameMail = (left: string | undefined, right: string): boolean => {
  const normalizedLeft = left?.trim().toLowerCase();
  return Boolean(normalizedLeft) && normalizedLeft === right.trim().toLowerCase();
};

export const sendTelegramNotice = async (
  comment: TelegramComment,
  config: TwikooConfig,
): Promise<void> => {
  const channel = stringConfig(config, 'PUSHOO_CHANNEL');
  const pushToken = stringConfig(config, 'PUSHOO_TOKEN');
  if (channel?.toLowerCase() !== 'telegram' || !pushToken) {
    return;
  }
  if (comment.isSpam && stringConfig(config, 'NOTIFY_SPAM') === 'false') {
    return;
  }
  if (sameMail(stringConfig(config, 'BLOGGER_EMAIL'), comment.mail)) {
    return;
  }

  const separator = pushToken.indexOf('#');
  const botToken = pushToken.slice(0, separator);
  const chatId = pushToken.slice(separator + 1);
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken) || !/^(?:-?\d+|@[A-Za-z0-9_]+)$/.test(chatId)) {
    throw new Error('PUSHOO_TOKEN must contain a Telegram bot token and chat ID separated by #.');
  }

  const title =
    stringConfig(config, 'MAIL_SUBJECT_ADMIN') ||
    `${stringConfig(config, 'SITE_NAME') ?? ''}有新评论了`;
  const url = commentUrl(comment, config);
  const link = url ? `\n\n<a href="${url}">查看原文</a>` : '';
  const text = `<b>${escapeHtml(title, MAX_TITLE_LENGTH)}</b>

<b>${escapeHtml(comment.nick, MAX_NICK_LENGTH)}</b>
<blockquote>${escapeHtml(htmlToText(comment.comment), MAX_COMMENT_LENGTH)}</blockquote>${link}

<code>${escapeHtml(comment.mail, MAX_MAIL_LENGTH)}</code> · <code>${escapeHtml(comment.ip, MAX_IP_LENGTH)}</code>`;
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      chat_id: chatId,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    }),
  });
  const result = (await response.json().catch(() => undefined)) as
    { ok?: boolean; description?: string } | undefined;
  if (!response.ok || result?.ok !== true) {
    const detail =
      result?.description || (!response.ok && response.statusText) || 'Invalid response';
    throw new Error(`Telegram send failed: ${response.status} ${detail}`);
  }
};
