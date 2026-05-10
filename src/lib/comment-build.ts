import type { NewComment } from '@/db';
import type { EventPayloads, RequestCtx } from '@/types';

import { isAdmin } from '@/lib/auth';
import { ResponseCode, TwikooError } from '@/lib/errors';
import { newCommentId } from '@/lib/id';
import { EMPTY_STRING_ARRAY_JSON } from '@/lib/json-string';
import { sanitizeHtml } from '@/lib/sanitize';
import {
  addQQMailSuffix,
  equalsMail,
  isQQ,
  logger,
  md5,
  normalizeMail,
  preCheckSpam,
  sha256,
} from '@/twikoo';

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
    ups: EMPTY_STRING_ARRAY_JSON,
    downs: EMPTY_STRING_ARRAY_JSON,
    top: 0,
    avatar,
  };
};
