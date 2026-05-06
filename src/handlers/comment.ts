import type { Comment } from '../db';
import type { Handler } from '../types';

import { isAdmin } from '../lib/auth';
import { formatIpRegion } from '../lib/geo';
import { parseComment, validate } from '../twikoo';

const MAX_TIMESTAMP_MILLIS = 41025312000000;
const MAX_QUERY_LIMIT = 500;

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
