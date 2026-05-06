import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { config } from './schema';

export class ConfigDB {
  constructor(private readonly db: DrizzleD1Database) {}

  async read(): Promise<string> {
    const [row] = await this.db.select({ value: config.value }).from(config).limit(1);
    return row?.value ?? '';
  }

  async write(value: string): Promise<void> {
    await this.db.update(config).set({ value });
  }
}
