import type { Handler } from '../types';

import { getPasswordStatus, login, setPassword } from './auth';
import {
  commentDeleteForAdmin,
  commentDeleteForUser,
  commentExportForAdmin,
  commentGet,
  commentGetForAdmin,
  commentLike,
  commentSetForAdmin,
  commentSubmit,
  getCommentsCount,
  getRecentComments,
} from './comment';
import { getConfig, getConfigForAdmin, setConfig } from './config';
import { counterGet } from './counter';
import { imageUpload } from './image';
import { commentImportForAdmin } from './import';
import { emailTest } from './mail';
import { getFuncVersion } from './meta';
import { getQqNick } from './qq';

export const handlers: Record<string, Handler> = {
  COMMENT_DELETE_FOR_ADMIN: commentDeleteForAdmin,
  COMMENT_DELETE_FOR_USER: commentDeleteForUser,
  COMMENT_EXPORT_FOR_ADMIN: commentExportForAdmin,
  COMMENT_GET: commentGet,
  COMMENT_GET_FOR_ADMIN: commentGetForAdmin,
  COMMENT_IMPORT_FOR_ADMIN: commentImportForAdmin,
  COMMENT_LIKE: commentLike,
  COMMENT_SET_FOR_ADMIN: commentSetForAdmin,
  COMMENT_SUBMIT: commentSubmit,
  COUNTER_GET: counterGet,
  EMAIL_TEST: emailTest,
  GET_COMMENTS_COUNT: getCommentsCount,
  GET_CONFIG: getConfig,
  GET_CONFIG_FOR_ADMIN: getConfigForAdmin,
  GET_FUNC_VERSION: getFuncVersion,
  GET_PASSWORD_STATUS: getPasswordStatus,
  GET_QQ_NICK: getQqNick,
  GET_RECENT_COMMENTS: getRecentComments,
  LOGIN: login,
  SET_CONFIG: setConfig,
  SET_PASSWORD: setPassword,
  UPLOAD_IMAGE: imageUpload,
};
