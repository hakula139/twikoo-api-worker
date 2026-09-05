import type { NewComment } from '@/db';
import type { RequestCtx } from '@/types';

import { checkAkismet } from '@/lib/akismet';
import { stringConfig } from '@/lib/config-read';
import { configWithSecrets, secret } from '@/lib/secret';
import { sendTelegramNotice } from '@/shims/telegram';
import { equalsMail, logger, noticeMaster, noticeReply, sendNotice } from '@/twikoo';
import { mkCommentId } from '@/types';

// Akismet and notification failures are isolated because this work is best-effort.
export const postSubmit = async (saved: NewComment, ctx: RequestCtx): Promise<void> => {
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
    const getParentComment = async (curr: unknown): Promise<unknown> => {
      const parentId = (curr as { pid?: string }).pid;
      return parentId ? ctx.db.comment.byId(mkCommentId(parentId)) : undefined;
    };
    const config = configWithSecrets(ctx);
    if (saved.isSpam && config.NOTIFY_SPAM === 'false') {
      return;
    }
    const pushChannel = stringConfig(config, 'PUSHOO_CHANNEL');
    const pushToken = stringConfig(config, 'PUSHOO_TOKEN');
    const upstreamComment = { ...saved, id: saved._id };
    if (pushChannel && pushToken) {
      const operations: Promise<unknown>[] = [
        noticeReply(upstreamComment, config, getParentComment),
      ];
      if (config.SC_MAIL_NOTIFY === 'true') {
        operations.push(noticeMaster(upstreamComment, config));
      }
      if (pushChannel.toLowerCase() === 'telegram') {
        if (!equalsMail(stringConfig(config, 'BLOGGER_EMAIL') ?? '', saved.mail)) {
          operations.push(sendTelegramNotice(saved, config, pushToken));
        }
      } else {
        logger.warn('Configured instant-push channel is not supported.');
      }
      const results = await Promise.allSettled(operations);
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') {
        throw failure.reason;
      }
    } else {
      await sendNotice(upstreamComment, config, getParentComment);
    }
  } catch (error) {
    logger.error({ stage: 'notify', id: saved._id, url: saved.url, error }, 'postSubmit failed');
  }
};
