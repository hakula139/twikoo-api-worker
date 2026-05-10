import type { NewComment } from '@/db';
import type { RequestCtx } from '@/types';

import { checkAkismet } from '@/lib/akismet';
import { configWithSecrets, secret } from '@/lib/secret';
import { logger, sendNotice } from '@/twikoo';
import { mkCommentId } from '@/types';

// Side effects after a comment is persisted: Akismet rescore + email notice.
// Each phase is wrapped in its own try/catch so a failure in one doesn't
// short-circuit the other; both run best-effort under ctx.waitUntil.
export const postSubmit = async (saved: NewComment, ctx: RequestCtx): Promise<void> => {
  // Mutate `saved` in place so sendNotice sees fresh isSpam — upstream
  // suppresses spam notifications when NOTIFY_SPAM='false'.
  try {
    const akismetKey = secret(ctx, 'AKISMET_KEY') ?? '';
    if (akismetKey && akismetKey !== 'MANUAL_REVIEW') {
      const blog = ctx.config.SITE_URL || `https://${new URL(ctx.request.url).host}`;
      const isSpam = await checkAkismet({
        apiKey: akismetKey,
        blog,
        userIp: saved.ip,
        userAgent: saved.ua,
        permalink: saved.href,
        author: saved.nick,
        authorEmail: saved.mail,
        authorUrl: saved.link,
        content: saved.comment,
      });
      if (isSpam) {
        saved.isSpam = 1;
        await ctx.db.comment.updateSpam(saved._id, 1, Date.now());
      }
    }
  } catch (error) {
    logger.error({ stage: 'akismet', id: saved._id, url: saved.url, error }, 'postSubmit failed');
  }

  try {
    // sendNotice consumes the upstream comment shape; our row is compatible.
    const getParentComment = async (curr: unknown): Promise<unknown> => {
      const parentId = (curr as { pid?: string }).pid;
      return parentId ? ctx.db.comment.byId(mkCommentId(parentId)) : undefined;
    };
    await sendNotice(saved, configWithSecrets(ctx), getParentComment);
  } catch (error) {
    logger.error(
      { stage: 'sendNotice', id: saved._id, url: saved.url, error },
      'postSubmit failed',
    );
  }
};
