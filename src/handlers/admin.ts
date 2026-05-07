import type { AdminFilter, Bit, NewComment } from '../db';
import type { Handler, RequestCtx } from '../types';

import { isAdmin } from '../lib/auth';
import { ResponseCode, TwikooError } from '../lib/errors';
import { formatIpRegion } from '../lib/geo';
import { validate } from '../twikoo';

const requireAdmin = (ctx: RequestCtx): void => {
  if (!isAdmin(ctx.uid, ctx.config)) {
    throw new TwikooError(ResponseCode.NEED_LOGIN, '请先登录');
  }
};

const buildFilter = (payload: Record<string, unknown>): AdminFilter => {
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
  const filter = buildFilter(payload);

  const [count, rows] = await Promise.all([
    ctx.db.comment.countForAdmin(filter),
    ctx.db.comment.listForAdmin(filter, per, per * (page - 1)),
  ]);

  // Upstream's `parseCommentForAdmin` runs `getIpRegion({detail: true})`, which
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
