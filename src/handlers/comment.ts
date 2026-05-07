import type { Comment } from '../db';
import type { Handler } from '../types';

import { isAdmin } from '../lib/auth';
import { formatIpRegion } from '../lib/geo';
import { getAvatar, getMailMd5, getUrlsQuery, parseComment, validate } from '../twikoo';

const MAX_TIMESTAMP_MILLIS = 41025312000000;
const MAX_QUERY_LIMIT = 500;
const RECENT_DEFAULT_PAGE_SIZE = 10;
const RECENT_MAX_PAGE_SIZE = 100;

const stripHtml = (html: string): string => html.replace(/<[^>]*>/g, '');

interface ParsedComment {
  id: string;
  ipRegion?: string;
  replies?: ParsedComment[];
  [key: string]: unknown;
}

type DecodedComment = Omit<Comment, 'ups' | 'downs'> & { ups: string[]; downs: string[] };

const decodeVotes = (row: Comment): DecodedComment => ({
  ...row,
  ups: row.ups ? (JSON.parse(row.ups) as string[]) : [],
  downs: row.downs ? (JSON.parse(row.downs) as string[]) : [],
});

export const commentGet: Handler = async (payload, ctx) => {
  validate(payload, ['url']);

  const url = payload.url as string;
  const before = (payload.before as number | undefined) ?? MAX_TIMESTAMP_MILLIS;
  const showAll = isAdmin(ctx.uid, ctx.config);
  const pageSize = Number(ctx.config.COMMENT_PAGE_SIZE) || 8;

  const total = await ctx.db.comment.count(url, showAll, ctx.uid);
  const probed = await ctx.db.comment.list(url, showAll, ctx.uid, before, 0, pageSize + 1);
  const more = probed.length > pageSize;
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
