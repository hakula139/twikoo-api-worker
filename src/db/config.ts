import type { DrizzleD1Database } from 'drizzle-orm/d1';

import type { Config } from './schema';

import { config } from './schema';

export class ConfigDB {
  constructor(private readonly db: DrizzleD1Database) {}

  async exportAll(): Promise<Config[]> {
    return this.db.select().from(config);
  }

  async read(): Promise<string> {
    const [row] = await this.db.select({ value: config.value }).from(config).limit(1);
    return row?.value ?? '';
  }

  // Atomic upsert against the pinned id = 1 row; covers fresh deploys and
  // the hot path with the same statement.
  async write(value: string): Promise<void> {
    await this.db
      .insert(config)
      .values({ id: 1, value })
      .onConflictDoUpdate({ target: config.id, set: { value } });
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
