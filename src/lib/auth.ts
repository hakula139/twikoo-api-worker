import type { TwikooConfig } from '../types';

import { md5 } from '../twikoo';

export const isAdmin = (uid: string, config: TwikooConfig): boolean =>
  Boolean(config.ADMIN_PASS) && md5(uid) === config.ADMIN_PASS;
