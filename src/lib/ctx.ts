import type { DB } from '@/db';
import type { Env, TwikooConfig } from '@/types';

import { isPlainObject } from './guards';

// Do not propagate the raw config row because it normally contains secrets.
export type LoadConfigResult =
  | { kind: 'ok'; config: TwikooConfig; droppedKeys: readonly string[] }
  | { kind: 'corrupted'; length: number; parseError: unknown };

// ADMIN_PASS_HASH keeps a fresh deployment claimable without an open first-call race.
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

const pruneConfig = (
  parsed: Record<string, unknown>,
): { config: TwikooConfig; droppedKeys: readonly string[] } => {
  const config: TwikooConfig = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
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
