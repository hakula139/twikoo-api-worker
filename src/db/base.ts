import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

// Caches prepared statements per instance to amortise the parse cost across
// the multiple queries a single request typically issues.
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
