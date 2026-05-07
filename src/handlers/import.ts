import type { Bit, NewComment } from '../db';
import type { Handler } from '../types';

import { XMLParser } from 'fast-xml-parser';

import { requireAdmin } from '../lib/auth';
import { ResponseCode, TwikooError } from '../lib/errors';
import { newCommentId } from '../lib/id';
import {
  commentImportArtalk,
  commentImportArtalk2,
  commentImportDisqus,
  commentImportTwikoo,
  commentImportValine,
  jsonParse,
  validate,
} from '../twikoo';

type ImportSource = 'twikoo' | 'valine' | 'disqus' | 'artalk' | 'artalk2';

const IMPORT_SOURCES = [
  'twikoo',
  'valine',
  'disqus',
  'artalk',
  'artalk2',
] as const satisfies readonly ImportSource[];

const isImportSource = (s: string): s is ImportSource =>
  (IMPORT_SOURCES as readonly string[]).includes(s);

// Upstream's commentImport* return loosely-typed shapes that don't match our
// strict NewComment schema; treat them as Records and normalize per row.
type ImportedRow = Record<string, unknown>;

export const commentImportForAdmin: Handler<'COMMENT_IMPORT_FOR_ADMIN'> = async (payload, ctx) => {
  requireAdmin(ctx);
  validate(payload, ['source', 'file']);

  if (!isImportSource(payload.source)) {
    throw new TwikooError(ResponseCode.FAIL, `Unsupported source: ${payload.source}`);
  }

  const log: string[] = [];
  const append = (msg: string): void => {
    log.push(`${new Date().toISOString()} ${msg}`);
  };

  append(`开始导入 ${payload.source}`);

  let imported: ImportedRow[] | undefined;
  try {
    imported = await runImport(payload.source, payload.file, append);
  } catch (e) {
    append(`解析失败：${(e as Error).message}`);
    throw new TwikooError(ResponseCode.FAIL, log.join('\n'));
  }

  if (imported && imported.length > 0) {
    const rows = imported.map(normalizeRow);
    await ctx.db.comment.saveMany(rows);
    append(`导入成功 ${rows.length} 条评论`);
  } else if (imported) {
    append('未发现可导入的评论');
  }

  return { log: log.join('\n') };
};

const runImport = async (
  source: ImportSource,
  file: string,
  log: (msg: string) => void,
): Promise<ImportedRow[] | undefined> => {
  if (source === 'disqus') {
    const parsed = parseDisqusXml(file);
    log('评论文件 XML 解析成功');
    return commentImportDisqus(parsed, log) as Promise<ImportedRow[] | undefined>;
  }

  const json = jsonParse(file);
  log('评论文件 JSON 解析成功');
  switch (source) {
    case 'twikoo':
      return commentImportTwikoo(json, log) as Promise<ImportedRow[] | undefined>;
    case 'valine':
      return commentImportValine(json, log) as Promise<ImportedRow[] | undefined>;
    case 'artalk':
      return commentImportArtalk(json, log) as Promise<ImportedRow[] | undefined>;
    case 'artalk2':
      return commentImportArtalk2(json, log) as Promise<ImportedRow[] | undefined>;
  }
};

// Upstream's `commentImportDisqus` was written against `xml2js` output: every
// element is an array, attributes live under `$`, text is the array element.
// `fast-xml-parser` natively returns scalars for single elements, so we wrap
// non-`$` keys in arrays after parsing.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  attributesGroupName: '$',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

const parseDisqusXml = (text: string): unknown => {
  const raw = xmlParser.parse(text) as Record<string, unknown>;
  return wrapElementsAsArrays(raw);
};

const wrapElementsAsArrays = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(wrapElementsAsArrays);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '$') {
        out.$ = v;
      } else if (Array.isArray(v)) {
        out[k] = v.map(wrapElementsAsArrays);
      } else {
        out[k] = [wrapElementsAsArrays(v)];
      }
    }
    return out;
  }
  return value;
};

const toBit = (v: unknown): Bit => (v === 1 || v === '1' || v === true || v === 'true' ? 1 : 0);

const toJsonArray = (v: unknown): string => {
  if (typeof v === 'string') {
    return v || '[]';
  }
  if (Array.isArray(v)) {
    return JSON.stringify(v);
  }
  return '[]';
};

// Upstream sources produce heterogeneous shapes — some omit fields entirely,
// some carry MongoDB-style booleans, our own export carries D1's 0/1 + JSON
// strings. Coerce everything into NewComment with safe defaults.
const normalizeRow = (raw: ImportedRow): NewComment => {
  const now = Date.now();
  return {
    _id: typeof raw._id === 'string' && raw._id ? raw._id : newCommentId(),
    uid: (raw.uid as string | undefined) ?? '',
    nick: (raw.nick as string | undefined) ?? '',
    mail: (raw.mail as string | undefined) ?? '',
    mailMd5: (raw.mailMd5 as string | undefined) ?? '',
    link: (raw.link as string | undefined) ?? '',
    ua: (raw.ua as string | undefined) ?? '',
    ip: (raw.ip as string | undefined) ?? '',
    ipRegion: (raw.ipRegion as string | undefined) ?? '',
    master: toBit(raw.master),
    url: (raw.url as string | undefined) ?? '',
    href: (raw.href as string | undefined) ?? '',
    comment: (raw.comment as string | undefined) ?? '',
    pid: (raw.pid as string | undefined) ?? '',
    rid: (raw.rid as string | undefined) ?? '',
    isSpam: toBit(raw.isSpam),
    created: typeof raw.created === 'number' ? raw.created : now,
    updated: typeof raw.updated === 'number' ? raw.updated : now,
    ups: toJsonArray(raw.ups),
    downs: toJsonArray(raw.downs),
    top: toBit(raw.top),
    avatar: (raw.avatar as string | undefined) ?? '',
  };
};
