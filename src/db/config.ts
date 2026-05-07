import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { config } from './schema';

export class ConfigDB {
  constructor(private readonly db: DrizzleD1Database) {}

  async read(): Promise<string> {
    const [row] = await this.db.select({ value: config.value }).from(config).limit(1);
    return row?.value ?? '';
  }

  // Single-row table — clear + insert lets a fresh deploy with no config row
  // also write successfully (a bare `update` would be a no-op on empty).
  async write(value: string): Promise<void> {
    await this.db.delete(config);
    await this.db.insert(config).values({ value });
  }

  async writePatch(patch: Record<string, unknown>): Promise<void> {
    const current = await this.read();
    const merged = {
      ...(current ? (JSON.parse(current) as Record<string, unknown>) : {}),
      ...patch,
    };
    await this.write(JSON.stringify(merged));
  }
}
