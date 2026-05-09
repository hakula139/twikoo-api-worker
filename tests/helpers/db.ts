import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';

import { DB } from '@/db';
import schemaSql from '../fixtures/schema.sql?raw';

// `drizzle-kit export` writes plain DDL with `;` statement terminators.
// applyD1Migrations is idempotent (tracks applied migrations in
// `d1_migrations`), so calling it from each suite's beforeAll is safe
// even when miniflare reuses the binding across files in the same worker.
const migrationQueries = schemaSql
  .split(';')
  .map((q: string) => q.trim())
  .filter(Boolean);

export const applyTestSchema = async (): Promise<void> => {
  await applyD1Migrations(env.DB, [{ name: '0000_init', queries: migrationQueries }]);
};

// Truncate-equivalent for SQLite — DELETE without WHERE is fast on small
// fixture sets, and avoids re-running schema between tests.
export const resetTestDb = async (): Promise<void> => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM comment'),
    env.DB.prepare('DELETE FROM config'),
    env.DB.prepare('DELETE FROM counter'),
  ]);
};

export const drizzleClient = (): DrizzleD1Database => drizzle(env.DB);

export const dbInstance = (): DB => new DB(env.DB);
