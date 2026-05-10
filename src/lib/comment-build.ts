import type { NewComment } from '@/db';
import type { EventPayloads, JsonString, RequestCtx } from '@/types';

import { isAdmin } from '@/lib/auth';
import { checkAkismet } from '@/lib/akismet';
import { ResponseCode, TwikooError } from '@/lib/errors';
import { newCommentId } from '@/lib/id';
import { sanitizeHtml } from '@/lib/sanitize';
import { configWithSecrets, secret } from '@/lib/secret';
import {
  addQQMailSuffix,
  equalsMail,
  isQQ,
  logger,
  md5,
  normalizeMail,
  preCheckSpam,
  sendNotice,
  sha256,
} from '@/twikoo';
import { mkCommentId } from '@/types';

const QQ_AVATAR_API = 'https://aq.qq.com/cn2/get_img/get_face';

// Best-effort: any failure returns '' so `getAvatar` falls back to gravatar.
const fetchQqAvatar = async (qqMail: string): Promise<string> => {
  const qqNum = qqMail.replace(/@qq\.com$/i, '');
  try {
    const url = `${QQ_AVATAR_API}?img_type=3&uin=${encodeURIComponent(qqNum)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return '';
    }
    const data = await response.json<{ url?: string }>();
    return data.url ?? '';
  } catch (error) {
    logger.warn('Failed to fetch QQ avatar:', error);
    return '';
  }
};

export const buildComment = async (
  payload: EventPayloads['COMMENT_SUBMIT'],
  ctx: RequestCtx,
): Promise<NewComment> => {
  const isAdminUser = isAdmin(ctx.uid, ctx.config);
  const isBlogger = equalsMail(payload.mail ?? '', ctx.config.BLOGGER_EMAIL ?? '');
  if (isBlogger && !isAdminUser) {
    throw new TwikooError(ResponseCode.NEED_LOGIN, '请先登录管理面板，再使用博主身份发送评论');
  }

  const timestamp = Date.now();
  const hashMail = (mail: string): string => {
    const normalized = normalizeMail(mail);
    return ctx.config.GRAVATAR_CDN === 'cravatar.cn' ? md5(normalized) : sha256(normalized);
  };

  let mail = payload.mail ?? '';
  let avatar = '';
  if (mail && isQQ(mail)) {
    mail = addQQMailSuffix(mail);
    avatar = await fetchQqAvatar(mail);
  }

  return {
    _id: newCommentId(),
    uid: ctx.uid,
    nick: payload.nick || '匿名',
    mail,
    mailMd5: mail ? hashMail(mail) : '',
    link: payload.link ?? '',
    ua: payload.ua,
    ip: ctx.ip,
    ipRegion: ctx.region,
    master: isBlogger ? 1 : 0,
    url: payload.url,
    href: payload.href ?? '',
    comment: sanitizeHtml(payload.comment),
    pid: payload.pid || (payload.rid ?? ''),
    rid: payload.rid ?? '',
    isSpam: !isAdminUser && preCheckSpam(payload, ctx.config) ? 1 : 0,
    created: timestamp,
    updated: timestamp,
    ups: '[]' as JsonString<string[]>,
    downs: '[]' as JsonString<string[]>,
    top: 0,
    avatar,
  };
};

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
