import {
  addQQMailSuffix,
  equalsMail,
  getAvatar,
  getConfig,
  getConfigForAdmin,
  getFuncVersion,
  getMailMd5,
  getPasswordStatus,
  getUrlsQuery,
  isQQ,
  normalizeMail,
  parseComment,
  preCheckSpam,
  validate,
} from 'twikoo-func/utils';
import {
  commentImportArtalk,
  commentImportArtalk2,
  commentImportDisqus,
  commentImportTwikoo,
  commentImportValine,
  jsonParse,
} from 'twikoo-func/utils/import';
import { getHtmlToText, getMd5, getSha256, setCustomLibs } from 'twikoo-func/utils/lib';
import logger from 'twikoo-func/utils/logger';
import { emailTest, noticeMaster, noticeReply, sendNotice } from 'twikoo-func/utils/notify';
import twikooFuncPkg from 'twikoo-func/package.json';

import { mailShim } from './shims/mail';
import { sanitizeShim } from './shims/sanitize';

// Initialize V8-compatible shims before twikoo-func resolves DOMPurify or nodemailer.
setCustomLibs({
  DOMPurify: sanitizeShim,
  nodemailer: mailShim,
});

export const VERSION: string = twikooFuncPkg.version;
export const htmlToText = getHtmlToText();

export const md5 = getMd5();
export const sha256 = getSha256();

export const stripCode = <T extends { code: number }>(result: T): Omit<T, 'code'> => {
  const { code: _code, ...rest } = result;

  return rest;
};

export {
  addQQMailSuffix,
  commentImportArtalk,
  commentImportArtalk2,
  commentImportDisqus,
  commentImportTwikoo,
  commentImportValine,
  emailTest,
  equalsMail,
  getAvatar,
  getConfig,
  getConfigForAdmin,
  getFuncVersion,
  getMailMd5,
  getPasswordStatus,
  getUrlsQuery,
  isQQ,
  jsonParse,
  logger,
  normalizeMail,
  noticeMaster,
  noticeReply,
  parseComment,
  preCheckSpam,
  sendNotice,
  validate,
};
