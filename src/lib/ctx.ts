import type { DB } from '@/db';
import type { Env, TwikooConfig } from '@/types';

import { isPlainObject } from './guards';

// Sentinel returned when the config row contains invalid JSON or a non-object
// payload. Dispatch maps this to CONFIG_NOT_EXIST so the widget can surface a
// distinct error vs. a legitimate empty config (no row yet).
export const CONFIG_CORRUPTED = Symbol('config-corrupted');

export type LoadConfigResult = TwikooConfig | typeof CONFIG_CORRUPTED;

// Reads the config row, parses it, and applies the ADMIN_PASS_HASH bootstrap.
// Bootstrap path: SET_PASSWORD is admin-only, so an empty config row would
// be unrecoverable. ADMIN_PASS_HASH (md5 of plaintext) seeds the admin
// identity from a wrangler secret. Once an admin rotates via SET_PASSWORD,
// the D1 value shadows env on subsequent requests.
export const loadConfig = async (env: Env, db: DB): Promise<LoadConfigResult> => {
  const raw = await db.config.read();
  if (!raw) {
    return env.ADMIN_PASS_HASH ? { ADMIN_PASS: env.ADMIN_PASS_HASH } : {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return CONFIG_CORRUPTED;
  }
  if (!isPlainObject(parsed)) {
    return CONFIG_CORRUPTED;
  }
  const config = parsed as TwikooConfig;
  if (!config.ADMIN_PASS && env.ADMIN_PASS_HASH) {
    config.ADMIN_PASS = env.ADMIN_PASS_HASH;
  }
  return config;
};
