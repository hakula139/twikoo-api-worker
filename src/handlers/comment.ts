import type { AdminFilter, Bit, Comment, CommentSort, NewComment } from '../db';
import type { Handler, RequestCtx } from '../types';

import { checkAkismet } from '../lib/akismet';
import { isAdmin, requireAdmin } from '../lib/auth';
import { ResponseCode, TwikooError } from '../lib/errors';
import { formatIpRegion } from '../lib/geo';
import { verifyTurnstile } from '../lib/turnstile';
import { sanitizeHtml } from '../shims/sanitize';
import {
  addQQMailSuffix,
  equalsMail,
  getAvatar,
  getMailMd5,
  getUrlsQuery,
  getQQAvatar,
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

const MAX_TIMESTAMP_MILLIS = 41025312000000;
const MAX_QUERY_LIMIT = 500;
const NON_NEWEST_LIMIT = 100;
const RECENT_DEFAULT_PAGE_SIZE = 10;
const RECENT_MAX_PAGE_SIZE = 100;

const stripHtml = (html: string): string => html.replace(/<[^>]*>/g, '');

const parseUidArray = (raw: string): string[] => (raw ? (JSON.parse(raw) as string[]) : []);

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

export const commentGet: Handler = async (payload, ctx) => {
  validate(payload, ['url']);

  const url = payload.url as string;
  const before = (payload.before as number | undefined) ?? MAX_TIMESTAMP_MILLIS;
  const showAll = isAdmin(ctx.uid, ctx.config);
  const pageSize = Number(ctx.config.COMMENT_PAGE_SIZE) || 8;
  const rawSort = typeof payload.sort === 'string' ? payload.sort : '';
  const sort: CommentSort = isCommentSort(rawSort) ? rawSort : 'newest';

  const total = await ctx.db.comment.count(url, showAll, ctx.uid);

  // The widget always sends `before = min(rendered.created)` as the load-more
  // cursor, which is only valid for `newest` (created desc). For `oldest` and
  // `popular`, fetch a generous cap in one shot and report `more = false` so the
  // widget hides its load-more button. Beyond NON_NEWEST_LIMIT on those tabs,
  // users can switch back to `newest` to keep paging.
  const isNewest = sort === 'newest';
  let probed: Comment[];
  let more = false;
  if (isNewest) {
    probed = await ctx.db.comment.list(url, showAll, ctx.uid, before, 0, pageSize + 1, sort);
    more = probed.length > pageSize;
  } else if (!payload.before) {
    probed = await ctx.db.comment.list(
      url,
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
      : await ctx.db.comment.list(url, showAll, ctx.uid, MAX_TIMESTAMP_MILLIS, 1, MAX_QUERY_LIMIT);

  const heads = [...top, ...main];
  const replies = await ctx.db.comment.replies(
    url,
    showAll,
    ctx.uid,
    heads.map((c) => c._id),
  );
  const all = [...heads, ...replies];

  // twikoo-func's parseComment internally calls fn.getIpRegion when SHOW_REGION is
  // truthy, which tries to require @imaegoo/node-ip2region — a Node-only binary
  // lookup we can't ship on Workers. Force it off here, then patch ipRegion below.
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

export const getCommentsCount: Handler = async (payload, ctx) => {
  validate(payload, ['urls']);

  const urls = (payload.urls as string[]).filter(Boolean);
  const includeReply = !!payload.includeReply;

  const counts = await ctx.db.comment.countByUrls(getUrlsQuery(urls), includeReply);

  // Sum `/path` and `/path/` variants so callers see one count per requested URL.
  const data = urls.map((url) => ({
    url,
    count: getUrlsQuery([url]).reduce((acc, v) => acc + (counts.get(v) ?? 0), 0),
  }));

  return { data };
};

export const getRecentComments: Handler = async (payload, ctx) => {
  const urlsRaw = (payload.urls as string[] | undefined)?.filter(Boolean);
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

// Toggle: a fresh `up` clears any prior `down` (and vice versa); voting the
// same direction twice retracts the vote. Mirrors twikoo-func's `like()`.
const toggleVote = (
  ups: string[],
  downs: string[],
  uid: string,
  type: LikeType,
): { ups: string[]; downs: string[] } => {
  const [target, opposite] = type === 'up' ? [ups, downs] : [downs, ups];
  const targetNext = target.includes(uid) ? target.filter((u) => u !== uid) : [...target, uid];
  const oppositeNext = target.includes(uid) ? opposite : opposite.filter((u) => u !== uid);
  return type === 'up'
    ? { ups: targetNext, downs: oppositeNext }
    : { ups: oppositeNext, downs: targetNext };
};

export const commentLike: Handler = async (payload, ctx) => {
  validate(payload, ['id']);

  const id = payload.id as string;
  const type = (payload.type as string | undefined) ?? 'up';
  if (!isLikeType(type)) {
    throw new TwikooError(ResponseCode.FAIL, `Invalid like type: ${type}`);
  }

  const row = await ctx.db.comment.byId(id);
  if (!row) {
    throw new TwikooError(ResponseCode.FAIL, 'Comment not found.');
  }

  const next = toggleVote(parseUidArray(row.ups), parseUidArray(row.downs), ctx.uid, type);
  await ctx.db.comment.updateVotes(id, JSON.stringify(next.ups), JSON.stringify(next.downs));

  return { updated: 1 };
};

const FREQUENCY_WINDOW_MS = 10 * 60 * 1000;

const enforceFrequencyLimit = async (ctx: RequestCtx): Promise<void> => {
  const since = Date.now() - FREQUENCY_WINDOW_MS;

  const perIp = parseInt(String(ctx.config.LIMIT_PER_MINUTE ?? ''), 10);
  if (Number.isFinite(perIp) && perIp > 0) {
    const count = await ctx.db.comment.countSinceByIp(since, ctx.ip);
    if (count > perIp) {
      throw new TwikooError(ResponseCode.FAIL, '发言频率过高');
    }
  }

  const global = parseInt(String(ctx.config.LIMIT_PER_MINUTE_ALL ?? ''), 10);
  if (Number.isFinite(global) && global > 0) {
    const count = await ctx.db.comment.countSince(since);
    if (count > global) {
      throw new TwikooError(ResponseCode.FAIL, '评论太火爆啦 >_< 请稍后再试');
    }
  }
};

const enforceTurnstile = async (
  payload: Record<string, unknown>,
  ctx: RequestCtx,
): Promise<void> => {
  if (ctx.config.CAPTCHA_PROVIDER !== 'Turnstile') {
    return;
  }
  const secret = ctx.env.TURNSTILE_SECRET ?? ctx.config.TURNSTILE_SECRET_KEY;
  const siteKey = ctx.config.TURNSTILE_SITE_KEY;
  if (!secret || !siteKey) {
    return;
  }
  const token = (payload.turnstileToken as string | undefined) ?? '';
  if (!token) {
    throw new TwikooError(ResponseCode.CREDENTIALS_INVALID, '人机验证失败，请刷新页面重试');
  }
  const result = await verifyTurnstile({ secret, token, ip: ctx.ip });
  if (!result.success) {
    throw new TwikooError(
      ResponseCode.CREDENTIALS_INVALID,
      `人机验证失败：${result.errorCodes.join(', ')}`,
    );
  }
};

const newCommentId = (): string => crypto.randomUUID().replace(/-/g, '');

const buildComment = async (
  payload: Record<string, unknown>,
  ctx: RequestCtx,
  isAdminUser: boolean,
): Promise<NewComment> => {
  const isBlogger = equalsMail(
    (payload.mail as string | undefined) ?? '',
    ctx.config.BLOGGER_EMAIL ?? '',
  );
  if (isBlogger && !isAdminUser) {
    throw new TwikooError(ResponseCode.NEED_LOGIN, '请先登录管理面板，再使用博主身份发送评论');
  }

  const timestamp = Date.now();
  const hashMail = (mail: string): string => {
    const normalized = normalizeMail(mail);
    return ctx.config.GRAVATAR_CDN === 'cravatar.cn' ? md5(normalized) : sha256(normalized);
  };

  let mail = (payload.mail as string | undefined) ?? '';
  let avatar = '';
  if (mail && isQQ(mail)) {
    mail = addQQMailSuffix(mail);
    try {
      avatar = await getQQAvatar(mail);
    } catch (error) {
      logger.warn('getQQAvatar failed; falling back to gravatar:', error);
    }
  }

  return {
    _id: newCommentId(),
    uid: ctx.uid,
    nick: (payload.nick as string | undefined) || '匿名',
    mail,
    mailMd5: mail ? hashMail(mail) : '',
    link: (payload.link as string | undefined) ?? '',
    ua: payload.ua as string,
    ip: ctx.ip,
    ipRegion: ctx.region,
    master: isBlogger ? 1 : 0,
    url: payload.url as string,
    href: (payload.href as string | undefined) ?? '',
    comment: sanitizeHtml(payload.comment as string),
    pid: (payload.pid as string | undefined) || ((payload.rid as string | undefined) ?? ''),
    rid: (payload.rid as string | undefined) ?? '',
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
  try {
    const akismetKey = ctx.env.AKISMET_KEY ?? (ctx.config.AKISMET_KEY as string | undefined) ?? '';
    if (akismetKey && akismetKey !== 'MANUAL_REVIEW') {
      const blog =
        (ctx.config.SITE_URL as string | undefined) || `https://${new URL(ctx.request.url).host}`;
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
        await ctx.db.comment.updateSpam(saved._id, 1, Date.now());
      }
    }

    // sendNotice expects the upstream comment shape; our row is structurally
    // compatible (same field names). It looks up the parent for reply mails.
    const getParentComment = async (curr: unknown): Promise<unknown> => {
      const parentId = (curr as { pid?: string }).pid;
      return parentId ? ctx.db.comment.byId(parentId) : undefined;
    };
    await sendNotice(saved, ctx.config, getParentComment);
  } catch (error) {
    logger.error('Post-submit failed:', error);
  }
};

export const commentSubmit: Handler = async (payload, ctx) => {
  validate(payload, ['url', 'ua', 'comment']);

  await enforceFrequencyLimit(ctx);
  await enforceTurnstile(payload, ctx);

  const isAdminUser = isAdmin(ctx.uid, ctx.config);
  const newComment = await buildComment(payload, ctx, isAdminUser);

  await ctx.db.comment.save(newComment);
  ctx.waitUntil(postSubmit(newComment as Comment, ctx));

  return { id: newComment._id };
};

const buildAdminFilter = (payload: Record<string, unknown>): AdminFilter => {
  const type = payload.type as string | undefined;
  const isSpam: Bit | undefined = type === 'HIDDEN' ? 1 : type === 'VISIBLE' ? 0 : undefined;
  const rawKeyword = (payload.keyword as string | undefined)?.trim();
  const keyword = rawKeyword ? `%${rawKeyword}%` : undefined;
  return { isSpam, keyword };
};

export const commentGetForAdmin: Handler = async (payload, ctx) => {
  requireAdmin(ctx);
  validate(payload, ['per', 'page']);

  const per = Math.max(1, Number(payload.per) || 0);
  const page = Math.max(1, Number(payload.page) || 0);
  const filter = buildAdminFilter(payload);

  const [count, rows] = await Promise.all([
    ctx.db.comment.countForAdmin(filter),
    ctx.db.comment.listForAdmin(filter, per, per * (page - 1)),
  ]);

  // Upstream's parseCommentForAdmin runs getIpRegion({detail: true}), which
  // pulls a Node-only binary lookup we can't ship. Re-format the stored region
  // string instead — already populated at submit time from the request `cf`.
  const data = rows.map((c) => ({
    ...c,
    ipRegion: c.ipRegion ? formatIpRegion(c.ipRegion) : '',
  }));

  return { count, data };
};

export const commentSetForAdmin: Handler = async (payload, ctx) => {
  requireAdmin(ctx);
  validate(payload, ['id', 'set']);

  const id = payload.id as string;
  const set = payload.set as Partial<NewComment>;

  await ctx.db.comment.update(id, { ...set, updated: Date.now() });
  return { updated: 1 };
};

export const commentDeleteForAdmin: Handler = async (payload, ctx) => {
  requireAdmin(ctx);
  validate(payload, ['id']);

  await ctx.db.comment.delete(payload.id as string);
  return { deleted: 1 };
};

export const commentDeleteForUser: Handler = async (payload, ctx) => {
  validate(payload, ['id']);

  const id = payload.id as string;
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

export const commentExportForAdmin: Handler = async (payload, ctx) => {
  requireAdmin(ctx);

  const raw = (payload.collection as string | undefined) ?? 'comment';
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
