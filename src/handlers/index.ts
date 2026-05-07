import type { Handler } from '../types';

import { commentGet, getCommentsCount, getRecentComments } from './comment';
import { counterGet } from './counter';
import { getConfig } from './config';
import { getFuncVersion } from './meta';

export const handlers: Record<string, Handler> = {
  COMMENT_GET: commentGet,
  COUNTER_GET: counterGet,
  GET_COMMENTS_COUNT: getCommentsCount,
  GET_CONFIG: getConfig,
  GET_FUNC_VERSION: getFuncVersion,
  GET_RECENT_COMMENTS: getRecentComments,
};
