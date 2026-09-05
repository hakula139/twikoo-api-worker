import type { DB } from '@/db';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';

import { buildDb } from '@/db';
import schemaSql from '../fixtures/schema.sql?raw';

// drizzle-kit emits semicolon-delimited DDL. applyD1Migrations remains idempotent
// when Miniflare reuses the binding across suites.
const migrationQueries = schemaSql
  .split(';')
  .map((q: string) => q.trim())
  .filter(Boolean);

export const applyTestSchema = async (): Promise<void> => {
  await applyD1Migrations(env.DB, [{ name: '0000_init', queries: migrationQueries }]);
};

// Reset rows without rebuilding the shared test schema.
export const resetTestDb = async (): Promise<void> => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM comment'),
    env.DB.prepare('DELETE FROM config'),
    env.DB.prepare('DELETE FROM counter'),
  ]);
};

export const drizzleClient = (): DrizzleD1Database => drizzle(env.DB);

export const dbInstance = (): DB => buildDb(env.DB);
