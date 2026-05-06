import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

// Caches prepared statements inside the instance to amortise the per-statement
// parse cost across calls within (and across) a single isolate.
export abstract class DBBase {
  private readonly stmts = new Map<string, D1PreparedStatement>();

  constructor(protected readonly d1: D1Database) {}

  protected stmt(key: string, sql: string): D1PreparedStatement {
    let cached = this.stmts.get(key);
    if (!cached) {
      cached = this.d1.prepare(sql);
      this.stmts.set(key, cached);
    }
    return cached;
  }
}
