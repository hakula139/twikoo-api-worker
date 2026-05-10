import type { ExecutionContext } from '@cloudflare/workers-types';

import type { DB } from './db';
import type { ResponseCodeValue } from './lib/errors';

// Workers bindings (D1, R2) and the public URL — wired in wrangler.toml,
// always present at runtime.
export interface Bindings {
  DB: D1Database;
  R2: R2Bucket;
  R2_PUBLIC_URL: string;
}

// Wrangler secrets — optional so the smoke-test path runs without them;
// consumers must validate (see lib/secret#requireSecret for the throwing form).
export interface Secrets {
  ADMIN_PASS_HASH?: string;
  AKISMET_KEY?: string;
  QQ_API_KEY?: string;
  SENDER_EMAIL?: string;
  SMTP_PASS?: string;
  SMTP_USER?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface Env extends Bindings, Secrets {}

// Branded primitives keep identity strings and row ids from being passed
// interchangeably; mk* helpers localize the unavoidable cast.
export type Uid = string & { readonly __uid: unique symbol };
export type Ip = string & { readonly __ip: unique symbol };
export type CommentId = string & { readonly __commentId: unique symbol };

export const mkUid = (s: string): Uid => s as Uid;
export const mkIp = (s: string): Ip => s as Ip;
export const mkCommentId = (s: string): CommentId => s as CommentId;

// JSON-encoded payload of T. Forces a parse step before structural ops —
// `comment.ups.split(',')` on a `JsonString<string[]>` is a compile error.
export type JsonString<T> = string & { readonly __json: T };

// Single-row blob in the `config` table. Lists every key the worker reads
// directly. Upstream twikoo-func sets/reads its own keys under the index
// signature. Boolean-flavored keys (SHOW_REGION, TOP_DISABLED) are stored as
// 'true' / 'false' strings by the admin UI, so read via boolConfig instead of
// directly. Numeric-flavored keys (COMMENT_PAGE_SIZE, LIMIT_PER_MINUTE*,
// NSFW_THRESHOLD) likewise: read via numberConfig.
export interface TwikooConfig {
  ADMIN_PASS?: string;
  AKISMET_KEY?: string;
  BLOGGER_EMAIL?: string;
  CAPTCHA_PROVIDER?: string;
  COMMENT_PAGE_SIZE?: string;
  CORS_ALLOW_ORIGIN?: string;
  GRAVATAR_CDN?: string;
  IMAGE_CDN?: string;
  IMAGE_CDN_TOKEN?: string;
  IMAGE_CDN_URL?: string;
  LIMIT_PER_MINUTE?: string;
  LIMIT_PER_MINUTE_ALL?: string;
  NSFW_API_URL?: string;
  NSFW_THRESHOLD?: string;
  QQ_API_KEY?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_BUCKET?: string;
  S3_CDN_URL?: string;
  S3_ENDPOINT?: string;
  S3_PATH_PREFIX?: string;
  S3_REGION?: string;
  S3_SECRET_ACCESS_KEY?: string;
  SENDER_EMAIL?: string;
  SITE_URL?: string;
  SMTP_PASS?: string;
  SMTP_USER?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  [key: string]: string | boolean | number | undefined;
}

export interface RequestCtx {
  env: Env;
  request: Request;
  waitUntil: ExecutionContext['waitUntil'];
  ip: Ip;
  region: string;
  origin: string | null;
  uid: Uid;
  config: TwikooConfig;
  db: DB;
}

// Open index signature: events emit ad-hoc top-level fields (count, more, time, log, id).
export interface TwikooResponse {
  code: ResponseCodeValue;
  message?: string;
  data?: unknown;
  version?: string;
  accessToken?: string;
  [key: string]: unknown;
}

// One key per supported `event` field on incoming requests; the value is the
// trusted shape of that event's body. Required fields are non-optional here
// and enforced at runtime by `validate()` inside each handler.
export interface EventPayloads {
  COMMENT_DELETE_FOR_ADMIN: { id: string };
  COMMENT_DELETE_FOR_USER: { id: string };
  COMMENT_EXPORT_FOR_ADMIN: { collection?: string };
  COMMENT_GET: { url: string; before?: number; sort?: string };
  COMMENT_GET_FOR_ADMIN: { per: number; page: number; type?: string; keyword?: string };
  COMMENT_IMPORT_FOR_ADMIN: { source: string; file: string };
  COMMENT_LIKE: { id: string; type?: string };
  COMMENT_SET_FOR_ADMIN: { id: string; set: Record<string, unknown> };
  COMMENT_SUBMIT: {
    url: string;
    ua: string;
    comment: string;
    nick?: string;
    mail?: string;
    link?: string;
    href?: string;
    pid?: string;
    rid?: string;
    turnstileToken?: string;
  };
  COUNTER_GET: { url: string; title?: string };
  EMAIL_TEST: Record<string, unknown>;
  GET_COMMENTS_COUNT: { urls: string[]; includeReply?: boolean };
  GET_CONFIG: Record<string, never>;
  GET_CONFIG_FOR_ADMIN: Record<string, never>;
  GET_FUNC_VERSION: Record<string, never>;
  GET_PASSWORD_STATUS: Record<string, never>;
  GET_QQ_NICK: { qq: string };
  GET_RECENT_COMMENTS: { urls?: string[]; includeReply?: boolean; pageSize?: number };
  LOGIN: { password: string };
  SET_CONFIG: { config: Record<string, unknown> };
  SET_PASSWORD: { password: string };
  UPLOAD_IMAGE: { photo: string; fileName: string };
}

export type EventName = keyof EventPayloads;

// Returning `{}` is treated as SUCCESS. The event name is required so callers
// can't accidentally drop into the `payload: never` shape that a default would
// produce.
export type Handler<E extends EventName> = (
  payload: EventPayloads[E],
  ctx: RequestCtx,
) => Promise<Partial<TwikooResponse>>;

export type Handlers = { [E in EventName]: Handler<E> };
