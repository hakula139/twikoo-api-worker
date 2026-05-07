// Akismet HTTP comment-check. Replaces twikoo-func's `postCheckSpam` path,
// which goes through `akismet-api` (`require('http')` and friends) — fine on
// Node, awkward on Workers. Two POSTs to rest.akismet.com, urlencoded body,
// plain "true" / "false" response.

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
    return false;
  }

  const text = (await response.text()).trim();
  return text === 'true';
};
