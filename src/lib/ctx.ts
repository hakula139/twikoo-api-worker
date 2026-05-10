import type { DB } from '@/db';
import type { Env, TwikooConfig } from '@/types';

import { isPlainObject } from './guards';

// Discriminated result so the dispatcher can distinguish corruption from a
// legitimate empty config (no row yet) and still carry diagnostic context
// (length, parse error) for triage. The raw row is intentionally not
// propagated since it normally contains ADMIN_PASS and SMTP_PASS.
export type LoadConfigResult =
  | { kind: 'ok'; config: TwikooConfig }
  | { kind: 'corrupted'; length: number; parseError: unknown };

// Reads the config row, parses it, and applies the ADMIN_PASS_HASH bootstrap.
// Bootstrap: SET_PASSWORD is admin-only, so an empty row would be unrecoverable.
// ADMIN_PASS_HASH (md5 of plaintext) seeds the admin identity from a wrangler
// secret. Once an admin rotates via SET_PASSWORD, the D1 value shadows env on
// subsequent requests.
export const loadConfig = async (env: Env, db: DB): Promise<LoadConfigResult> => {
  const raw = await db.config.read();
  if (!raw) {
    return {
      kind: 'ok',
      config: env.ADMIN_PASS_HASH ? { ADMIN_PASS: env.ADMIN_PASS_HASH } : {},
    };
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
  const config = { ...parsed } as TwikooConfig;
  if (!config.ADMIN_PASS && env.ADMIN_PASS_HASH) {
    config.ADMIN_PASS = env.ADMIN_PASS_HASH;
  }
  return { kind: 'ok', config };
};
