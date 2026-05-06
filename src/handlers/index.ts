import type { Handler } from '../types';

import { counterGet } from './counter';
import { getConfig } from './config';
import { getFuncVersion } from './meta';

export const handlers: Record<string, Handler> = {
  COUNTER_GET: counterGet,
  GET_CONFIG: getConfig,
  GET_FUNC_VERSION: getFuncVersion,
};
