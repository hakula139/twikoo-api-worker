import { DBBase } from './base';

export class ConfigDB extends DBBase {
  async read(): Promise<string> {
    const row = await this.stmt('readConfig', 'SELECT value FROM config LIMIT 1').first<{
      value: string;
    }>();
    return row?.value ?? '';
  }

  async write(value: string): Promise<void> {
    await this.stmt('writeConfig', 'UPDATE config SET value = ?1').bind(value).run();
  }
}
