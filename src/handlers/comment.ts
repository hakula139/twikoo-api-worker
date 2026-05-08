import type { AdminFilter, Bit, Comment, CommentSort, NewComment } from '../db';
import type { EventPayloads, Handler, RequestCtx } from '../types';

import { checkAkismet } from '../lib/akismet';
import { isAdmin, requireAdmin } from '../lib/auth';
import { ResponseCode, TwikooError } from '../lib/errors';
import { formatIpRegion } from '../lib/geo';
import { newCommentId } from '../lib/id';
import { configWithSecrets, secret } from '../lib/secret';
import { verifyTurnstile } from '../lib/turnstile';
import { sanitizeHtml } from '../lib/sanitize';
import {
  addQQMailSuffix,
  equalsMail,
  getAvatar,
  getMailMd5,
  getUrlsQuery,
  isQQ,
  logger,
  md5,
  normalizeMail,
  parseComment,
  preCheckSpam,
  sendNotice,
  sha256,
  validate,
} from '../twikoo';

// Year 3270 — sentinel "no `before` cursor" so the `<` comparison always passes.
const MAX_TIMESTAMP_MILLIS = 41025312000000;
const MAX_QUERY_LIMIT = 500;
const NON_NEWEST_LIMIT = 100;
const RECENT_DEFAULT_PAGE_SIZE = 10;
const RECENT_MAX_PAGE_SIZE = 100;

const stripHtml = (html: string): string => html.replace(/<[^>]*>/g, '');

const parseUidArray = (raw: string): string[] => (raw ? (JSON.parse(raw) as string[]) : []);

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

interface ParsedComment {
  id: string;
  ipRegion?: string;
  replies?: ParsedComment[];
  [key: string]: unknown;
}

type DecodedComment = Omit<Comment, 'ups' | 'downs'> & { ups: string[]; downs: string[] };

const decodeVotes = (row: Comment): DecodedComment => ({
  ...row,
  ups: parseUidArray(row.ups),
  downs: parseUidArray(row.downs),
});

const SORT_VALUES = ['newest', 'oldest', 'popular'] as const satisfies readonly CommentSort[];
const isCommentSort = (s: string): s is CommentSort =>
  (SORT_VALUES as readonly string[]).includes(s);

export const commentGet: Handler<'COMMENT_GET'> = async (payload, ctx) => {
  validate(payload, ['url']);

  // Fan out `/path` and `/path/` so a viewer arriving at either form sees
  // comments posted on the other; matches getCommentsCount / getRecentComments.
  const urls = getUrlsQuery([payload.url]);
  const beforeRaw = Number(payload.before);
  const before = Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : MAX_TIMESTAMP_MILLIS;
  const showAll = isAdmin(ctx.uid, ctx.config);
  const pageSize = Number(ctx.config.COMMENT_PAGE_SIZE) || 8;
  const sort: CommentSort = payload.sort && isCommentSort(payload.sort) ? payload.sort : 'newest';

  const total = await ctx.db.comment.count(urls, showAll, ctx.uid);

  // The widget's `before` cursor (min rendered created) is only meaningful for
  // `newest`; `oldest` / `popular` fetch up to NON_NEWEST_LIMIT in one shot.
  const isNewest = sort === 'newest';
  let probed: Comment[];
  let more = false;
  if (isNewest) {
    probed = await ctx.db.comment.list(urls, showAll, ctx.uid, before, 0, pageSize + 1, sort);
    more = probed.length > pageSize;
  } else if (!payload.before) {
    probed = await ctx.db.comment.list(
      urls,
      showAll,
      ctx.uid,
      MAX_TIMESTAMP_MILLIS,
      0,
      NON_NEWEST_LIMIT,
      sort,
    );
  } else {
    probed = [];
  }
  const main = more ? probed.slice(0, pageSize) : probed;

  const top =
    ctx.config.TOP_DISABLED || payload.before
      ? []
      : await ctx.db.comment.list(urls, showAll, ctx.uid, MAX_TIMESTAMP_MILLIS, 1, MAX_QUERY_LIMIT);

  const heads = [...top, ...main];
  const replies = await ctx.db.comment.replies(
    urls,
    showAll,
    ctx.uid,
    heads.map((c) => c._id),
  );
  const all = [...heads, ...replies];

  // Force SHOW_REGION off so parseComment skips its Node-only ip2region
  // lookup; we patch ipRegion from the stored value below.
  const configForParse = { ...ctx.config, SHOW_REGION: 'false' };
  const parsed = parseComment(all.map(decodeVotes), ctx.uid, configForParse) as ParsedComment[];

  const showRegion = !!ctx.config.SHOW_REGION && ctx.config.SHOW_REGION !== 'false';
  if (showRegion) {
    const byId = new Map(all.map((c) => [c._id, c]));
    const patch = (dto: ParsedComment): void => {
      const original = byId.get(dto.id);
      if (original?.ipRegion) {
        dto.ipRegion = formatIpRegion(original.ipRegion);
      }
    };
    for (const pc of parsed) {
      patch(pc);
      for (const reply of pc.replies ?? []) {
        patch(reply);
      }
    }
  }

  return { data: parsed, more, count: total };
};

export const getCommentsCount: Handler<'GET_COMMENTS_COUNT'> = async (payload, ctx) => {
  validate(payload, ['urls']);

  const urls = payload.urls.filter(Boolean);
  const includeReply = !!payload.includeReply;

  const counts = await ctx.db.comment.countByUrls(getUrlsQuery(urls), includeReply);

  // Sum `/path` and `/path/` variants so callers see one count per requested URL.
  const data = urls.map((url) => ({
    url,
    count: getUrlsQuery([url]).reduce((acc, v) => acc + (counts.get(v) ?? 0), 0),
  }));

  return { data };
};

export const getRecentComments: Handler<'GET_RECENT_COMMENTS'> = async (payload, ctx) => {
  const urlsRaw = payload.urls?.filter(Boolean);
  const urls = urlsRaw?.length ? getUrlsQuery(urlsRaw) : undefined;
  const includeReply = !!payload.includeReply;
  const requested = Number(payload.pageSize) || RECENT_DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(requested, RECENT_MAX_PAGE_SIZE);

  const rows = await ctx.db.comment.recent(urls, includeReply, pageSize);

  const data = rows.map((c) => ({
    id: c._id,
    url: c.url,
    href: c.href,
    nick: c.nick,
    avatar: getAvatar(c, ctx.config),
    mailMd5: getMailMd5(c),
    link: c.link,
    comment: c.comment,
    commentText: stripHtml(c.comment),
    created: c.created,
  }));

  return { data };
};

type LikeType = 'up' | 'down';

const isLikeType = (s: string): s is LikeType => s === 'up' || s === 'down';

export const commentLike: Handler<'COMMENT_LIKE'> = async (payload, ctx) => {
  validate(payload, ['id']);

  const type = payload.type ?? 'up';
  if (!isLikeType(type)) {
    throw new TwikooError(ResponseCode.FAIL, `Invalid like type: ${type}`);
  }

  const matched = await ctx.db.comment.toggleVote(payload.id, ctx.uid, type);
  if (!matched) {
    throw new TwikooError(ResponseCode.FAIL, 'Comment not found.');
  }

  return { updated: 1 };
};

// 10-minute rolling window. Config keys are named `LIMIT_PER_MINUTE` for
// upstream parity, but they cap submissions over this window, not per minute.
const FREQUENCY_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_LIMIT_PER_IP = 10;

const positiveInt = (raw: unknown, fallback: number): number => {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }
  if (typeof raw === 'string') {
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
  return fallback;
};

const enforceFrequencyLimit = async (ctx: RequestCtx): Promise<void> => {
  const since = Date.now() - FREQUENCY_WINDOW_MS;

  const perIp = positiveInt(ctx.config.LIMIT_PER_MINUTE, DEFAULT_LIMIT_PER_IP);
  if ((await ctx.db.comment.countSinceByIp(since, ctx.ip)) > perIp) {
    throw new TwikooError(ResponseCode.FAIL, '发言频率过高');
  }

  const global = positiveInt(ctx.config.LIMIT_PER_MINUTE_ALL, 0);
  if (global > 0 && (await ctx.db.comment.countSince(since)) > global) {
    throw new TwikooError(ResponseCode.FAIL, '评论太火爆啦 >_< 请稍后再试');
  }
};

const enforceTurnstile = async (
  payload: EventPayloads['COMMENT_SUBMIT'],
  ctx: RequestCtx,
): Promise<void> => {
  if (ctx.config.CAPTCHA_PROVIDER !== 'Turnstile') {
    return;
  }
  const turnstileSecret = secret(ctx, 'TURNSTILE_SECRET_KEY');
  const siteKey = ctx.config.TURNSTILE_SITE_KEY;
  if (!turnstileSecret || !siteKey) {
    // Fail closed: provider is configured but credentials are missing —
    // silently skipping would let bots through with no signal.
    logger.error('Turnstile is enabled but TURNSTILE_SECRET_KEY / TURNSTILE_SITE_KEY is unset.');
    throw new TwikooError(ResponseCode.FAIL, '人机验证未配置完整，请联系管理员');
  }
  const token = payload.turnstileToken ?? '';
  if (!token) {
    throw new TwikooError(ResponseCode.CREDENTIALS_INVALID, '人机验证失败，请刷新页面重试');
  }
  const result = await verifyTurnstile({ secret: turnstileSecret, token, ip: ctx.ip });
  if (!result.success) {
    throw new TwikooError(
      ResponseCode.CREDENTIALS_INVALID,
      `人机验证失败：${result.errorCodes.join(', ')}`,
    );
  }
};

const buildComment = async (
  payload: EventPayloads['COMMENT_SUBMIT'],
  ctx: RequestCtx,
  isAdminUser: boolean,
): Promise<NewComment> => {
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
    ups: '[]',
    downs: '[]',
    top: 0,
    avatar,
  };
};

const postSubmit = async (saved: Comment, ctx: RequestCtx): Promise<void> => {
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
    logger.error('Akismet check failed for', saved._id, error);
  }

  try {
    // sendNotice expects the upstream comment shape; our row is structurally
    // compatible. It looks up the parent for reply mails.
    const getParentComment = async (curr: unknown): Promise<unknown> => {
      const parentId = (curr as { pid?: string }).pid;
      return parentId ? ctx.db.comment.byId(parentId) : undefined;
    };
    await sendNotice(saved, configWithSecrets(ctx), getParentComment);
  } catch (error) {
    logger.error('sendNotice failed for', saved._id, error);
  }
};

export const commentSubmit: Handler<'COMMENT_SUBMIT'> = async (payload, ctx) => {
  validate(payload, ['url', 'ua', 'comment']);

  await enforceFrequencyLimit(ctx);
  await enforceTurnstile(payload, ctx);

  const isAdminUser = isAdmin(ctx.uid, ctx.config);
  const newComment = await buildComment(payload, ctx, isAdminUser);

  await ctx.db.comment.save(newComment);
  ctx.waitUntil(postSubmit(newComment as Comment, ctx));

  return { id: newComment._id };
};

// Escape SQLite LIKE metacharacters; pairs with ESCAPE '\' in adminKeywordFilter.
const escapeLikePattern = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const buildAdminFilter = (payload: EventPayloads['COMMENT_GET_FOR_ADMIN']): AdminFilter => {
  const isSpam: Bit | undefined =
    payload.type === 'HIDDEN' ? 1 : payload.type === 'VISIBLE' ? 0 : undefined;
  const rawKeyword = payload.keyword?.trim();
  const keyword = rawKeyword ? `%${escapeLikePattern(rawKeyword)}%` : undefined;
  return { isSpam, keyword };
};

export const commentGetForAdmin: Handler<'COMMENT_GET_FOR_ADMIN'> = async (payload, ctx) => {
  requireAdmin(ctx);
  validate(payload, ['per', 'page']);

  const per = Math.max(1, Number(payload.per) || 0);
  const page = Math.max(1, Number(payload.page) || 0);
  const filter = buildAdminFilter(payload);

  const [count, rows] = await Promise.all([
    ctx.db.comment.countForAdmin(filter),
    ctx.db.comment.listForAdmin(filter, per, per * (page - 1)),
  ]);

  // Skip upstream parseCommentForAdmin (Node-only ip2region lookup); reformat
  // the stored region populated at submit time from request.cf.
  const data = rows.map((c) => ({
    ...c,
    ipRegion: c.ipRegion ? formatIpRegion(c.ipRegion) : '',
  }));

  return { count, data };
};

// Admin can only mutate moderation/content fields; identity, vote arrays, and
// timestamps stay immutable through this path.
const ADMIN_MUTABLE_FIELDS = ['comment', 'isSpam', 'top'] as const;

const pickAdminUpdate = (raw: Record<string, unknown>): Partial<NewComment> => {
  const out: Partial<NewComment> = {};
  for (const key of ADMIN_MUTABLE_FIELDS) {
    if (!(key in raw)) {
      continue;
    }
    const value = raw[key];
    if (key === 'comment' && typeof value === 'string') {
      out.comment = value;
    } else if (key === 'isSpam' && (value === 0 || value === 1)) {
      out.isSpam = value;
    } else if (key === 'top' && (value === 0 || value === 1)) {
      out.top = value;
    } else {
      throw new TwikooError(ResponseCode.FAIL, `Invalid value for ${key}`);
    }
  }
  return out;
};

export const commentSetForAdmin: Handler<'COMMENT_SET_FOR_ADMIN'> = async (payload, ctx) => {
  requireAdmin(ctx);
  validate(payload, ['id', 'set']);

  const set = pickAdminUpdate(payload.set);

  await ctx.db.comment.update(payload.id, { ...set, updated: Date.now() });
  return { updated: 1 };
};

export const commentDeleteForAdmin: Handler<'COMMENT_DELETE_FOR_ADMIN'> = async (payload, ctx) => {
  requireAdmin(ctx);
  validate(payload, ['id']);

  await ctx.db.comment.delete(payload.id);
  return { deleted: 1 };
};

export const commentDeleteForUser: Handler<'COMMENT_DELETE_FOR_USER'> = async (payload, ctx) => {
  validate(payload, ['id']);

  const id = payload.id;
  if (!ctx.uid) {
    // Anonymous comments have empty uid; an empty equality match would
    // collapse all anon authors into one delete-able pool.
    throw new TwikooError(ResponseCode.NEED_LOGIN, '请先登录');
  }
  const row = await ctx.db.comment.byId(id);
  if (!row) {
    throw new TwikooError(ResponseCode.FAIL, '评论不存在');
  }
  if (row.uid !== ctx.uid) {
    throw new TwikooError(ResponseCode.FAIL, '只能删除自己的评论');
  }

  await ctx.db.comment.delete(id);
  return { deleted: 1 };
};

type ExportCollection = 'comment' | 'counter' | 'config';
const EXPORT_COLLECTIONS = [
  'comment',
  'counter',
  'config',
] as const satisfies readonly ExportCollection[];
const isExportCollection = (s: string): s is ExportCollection =>
  (EXPORT_COLLECTIONS as readonly string[]).includes(s);

export const commentExportForAdmin: Handler<'COMMENT_EXPORT_FOR_ADMIN'> = async (payload, ctx) => {
  requireAdmin(ctx);

  const raw = payload.collection ?? 'comment';
  if (!isExportCollection(raw)) {
    throw new TwikooError(ResponseCode.FAIL, `Unsupported collection: ${raw}`);
  }

  const data = await exportRows(raw, ctx);
  return { data };
};

const exportRows = (collection: ExportCollection, ctx: RequestCtx): Promise<unknown[]> => {
  switch (collection) {
    case 'comment':
      return ctx.db.comment.exportAll();
    case 'counter':
      return ctx.db.counter.exportAll();
    case 'config':
      return ctx.db.config.exportAll();
  }
};
