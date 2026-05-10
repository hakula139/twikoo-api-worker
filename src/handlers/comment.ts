import type { AdminFilter, Bit, Comment, CommentSort, NewComment } from '@/db';
import type { EventPayloads, Handler, JsonString, RequestCtx } from '@/types';

import { mkCommentId } from '@/types';

import { isAdmin, requireAdmin } from '@/lib/auth';
import { enforceTurnstile } from '@/lib/captcha-guard';
import { buildComment, postSubmit } from '@/lib/comment-build';
import { ResponseCode, TwikooError } from '@/lib/errors';
import { formatIpRegion } from '@/lib/geo';
import { isPlainObject, isStringArray } from '@/lib/guards';
import { enforceFrequencyLimit } from '@/lib/rate-limit';
import { getAvatar, getMailMd5, getUrlsQuery, logger, parseComment, validate } from '@/twikoo';

// Year 3270 — sentinel "no `before` cursor" so the `<` comparison always passes.
const MAX_TIMESTAMP_MILLIS = 41025312000000;
const MAX_QUERY_LIMIT = 500;
const NON_NEWEST_LIMIT = 100;
const RECENT_DEFAULT_PAGE_SIZE = 10;
const RECENT_MAX_PAGE_SIZE = 100;

const stripHtml = (html: string): string => html.replace(/<[^>]*>/g, '');

const truncate = (s: string, max = 80): string => (s.length <= max ? s : `${s.slice(0, max)}...`);

const parseUidArray = (
  raw: JsonString<string[]> | null | undefined,
  commentId: string,
  field: string,
): string[] => {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    logger.warn(`Malformed ${field} JSON on comment ${commentId}: ${truncate(raw)}`);
    return [];
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
  ups: parseUidArray(row.ups, row._id, 'ups'),
  downs: parseUidArray(row.downs, row._id, 'downs'),
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
      const original = byId.get(mkCommentId(dto.id));
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
  if (!isStringArray(payload.urls)) {
    throw new TwikooError(ResponseCode.FAIL, '`urls` must be an array of strings.');
  }

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
  if (payload.urls !== undefined && !isStringArray(payload.urls)) {
    throw new TwikooError(ResponseCode.FAIL, '`urls` must be an array of strings.');
  }
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

  const matched = await ctx.db.comment.toggleVote(mkCommentId(payload.id), ctx.uid, type);
  if (!matched) {
    throw new TwikooError(ResponseCode.FAIL, 'Comment not found.');
  }

  return { updated: 1 };
};

export const commentSubmit: Handler<'COMMENT_SUBMIT'> = async (payload, ctx) => {
  validate(payload, ['url', 'ua', 'comment']);

  await enforceFrequencyLimit(ctx);
  await enforceTurnstile(payload, ctx);

  const newComment = await buildComment(payload, ctx);

  await ctx.db.comment.save(newComment);
  ctx.waitUntil(postSubmit(newComment, ctx));

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

const pickAdminUpdate = (raw: unknown): Partial<NewComment> => {
  if (!isPlainObject(raw)) {
    throw new TwikooError(ResponseCode.FAIL, '`set` must be an object.');
  }
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

  await ctx.db.comment.update(mkCommentId(payload.id), { ...set, updated: Date.now() });
  return { updated: 1 };
};

export const commentDeleteForAdmin: Handler<'COMMENT_DELETE_FOR_ADMIN'> = async (payload, ctx) => {
  requireAdmin(ctx);
  validate(payload, ['id']);

  await ctx.db.comment.delete(mkCommentId(payload.id));
  return { deleted: 1 };
};

export const commentDeleteForUser: Handler<'COMMENT_DELETE_FOR_USER'> = async (payload, ctx) => {
  validate(payload, ['id']);

  const id = mkCommentId(payload.id);
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
