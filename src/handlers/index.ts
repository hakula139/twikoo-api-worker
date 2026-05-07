import type { Handler } from '../types';

import { getPasswordStatus, login, setPassword } from './auth';
import {
  commentGet,
  commentLike,
  commentSubmit,
  getCommentsCount,
  getRecentComments,
} from './comment';
import { counterGet } from './counter';
import { getConfig } from './config';
import { getFuncVersion } from './meta';

export const handlers: Record<string, Handler> = {
  COMMENT_GET: commentGet,
  COMMENT_LIKE: commentLike,
  COMMENT_SUBMIT: commentSubmit,
  COUNTER_GET: counterGet,
  GET_COMMENTS_COUNT: getCommentsCount,
  GET_CONFIG: getConfig,
  GET_FUNC_VERSION: getFuncVersion,
  GET_PASSWORD_STATUS: getPasswordStatus,
  GET_RECENT_COMMENTS: getRecentComments,
  LOGIN: login,
  SET_PASSWORD: setPassword,
};
