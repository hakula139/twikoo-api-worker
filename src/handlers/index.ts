import type { Handler } from '../types';

import { commentGet } from './comment';
import { counterGet } from './counter';
import { getConfig } from './config';
import { getFuncVersion } from './meta';

export const handlers: Record<string, Handler> = {
  COMMENT_GET: commentGet,
  COUNTER_GET: counterGet,
  GET_CONFIG: getConfig,
  GET_FUNC_VERSION: getFuncVersion,
};
