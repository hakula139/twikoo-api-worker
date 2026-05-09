// Akismet HTTP comment-check; replaces twikoo-func's `postCheckSpam` path
// (akismet-api uses `require('http')` and friends).

import { logger } from '@/twikoo';

const checkUrl = (apiKey: string): string => `https://${apiKey}.rest.akismet.com/1.1/comment-check`;

export interface AkismetCheckOpts {
  apiKey: string;
  blog: string;
  userIp: string;
  userAgent: string;
  permalink?: string;
  author?: string;
  authorEmail?: string;
  authorUrl?: string;
  content: string;
}

export const checkAkismet = async (opts: AkismetCheckOpts): Promise<boolean> => {
  const body = new URLSearchParams({
    blog: opts.blog,
    user_ip: opts.userIp,
    user_agent: opts.userAgent,
    comment_type: 'comment',
    comment_content: opts.content,
  });
  if (opts.permalink) {
    body.set('permalink', opts.permalink);
  }
  if (opts.author) {
    body.set('comment_author', opts.author);
  }
  if (opts.authorEmail) {
    body.set('comment_author_email', opts.authorEmail);
  }
  if (opts.authorUrl) {
    body.set('comment_author_url', opts.authorUrl);
  }

  const response = await fetch(checkUrl(opts.apiKey), { method: 'POST', body });
  if (!response.ok) {
    // Fail-open. 4xx is usually a misconfigured key (admin should know); 5xx is transient.
    const fields = { provider: 'akismet', status: response.status };
    const message = 'non-OK; treating comment as ham';
    if (response.status >= 400 && response.status < 500) {
      logger.error(fields, message);
    } else {
      logger.warn(fields, message);
    }
    return false;
  }

  let text: string;
  try {
    text = (await response.text()).trim();
  } catch (error) {
    logger.warn({ provider: 'akismet', error }, 'response body read failed; treating as ham');
    return false;
  }
  return text === 'true';
};
