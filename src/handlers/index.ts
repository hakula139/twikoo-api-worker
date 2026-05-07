import type { Handler } from '../types';

import { commentDeleteForAdmin, commentGetForAdmin, commentSetForAdmin } from './admin';
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
  COMMENT_DELETE_FOR_ADMIN: commentDeleteForAdmin,
  COMMENT_GET: commentGet,
  COMMENT_GET_FOR_ADMIN: commentGetForAdmin,
  COMMENT_LIKE: commentLike,
  COMMENT_SET_FOR_ADMIN: commentSetForAdmin,
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
