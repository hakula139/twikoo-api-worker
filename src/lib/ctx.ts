import type { DB } from '@/db';
import type { Env, TwikooConfig } from '@/types';

import { isPlainObject } from './guards';

// Discriminated result so the dispatcher can distinguish corruption from a
// legitimate empty config (no row yet) and still carry diagnostic context
// for triage. The raw row is intentionally not propagated since it normally
// contains ADMIN_PASS and SMTP_PASS.
export type LoadConfigResult =
  | { kind: 'ok'; config: TwikooConfig; droppedKeys: readonly string[] }
  | { kind: 'corrupted'; length: number; parseError: unknown };

// Reads the config row, parses it, and applies the ADMIN_PASS_HASH bootstrap.
// Bootstrap: SET_PASSWORD is admin-only, so an empty row would be unrecoverable.
// ADMIN_PASS_HASH (md5 of plaintext) seeds the admin identity from a wrangler
// secret. Once an admin rotates via SET_PASSWORD, the D1 value shadows env on
// subsequent requests.
export const loadConfig = async (env: Env, db: DB): Promise<LoadConfigResult> => {
  const raw = await db.config.read();
  if (!raw) {
    return { kind: 'ok', config: bootstrap({}, env), droppedKeys: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (parseError) {
    return { kind: 'corrupted', length: raw.length, parseError };
  }
  if (!isPlainObject(parsed)) {
    return {
      kind: 'corrupted',
      length: raw.length,
      parseError: new Error(`expected JSON object, got ${typeof parsed}`),
    };
  }
  const { config, droppedKeys } = pruneConfig(parsed);
  return { kind: 'ok', config: bootstrap(config, env), droppedKeys };
};

// Drop entries whose value violates TwikooConfig's index signature
// (string | boolean | number | undefined). A nested object or array under any
// key would silently break consumers that rely on the typed accessors, so
// surface the dropped keys to the dispatcher for logging.
const pruneConfig = (
  parsed: Record<string, unknown>,
): { config: TwikooConfig; droppedKeys: readonly string[] } => {
  const config: TwikooConfig = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    // JSON.parse never produces `undefined`, so checking the three valued
    // primitives covers the index signature.
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
      config[key] = value;
    } else {
      droppedKeys.push(key);
    }
  }
  return { config, droppedKeys };
};

const bootstrap = (config: TwikooConfig, env: Env): TwikooConfig => {
  if (!config.ADMIN_PASS && env.ADMIN_PASS_HASH) {
    config.ADMIN_PASS = env.ADMIN_PASS_HASH;
  }
  return config;
};
