// Single boundary against twikoo-func. `setCustomLibs` runs at module load,
// before any helper is invoked.

import {
  addQQMailSuffix,
  equalsMail,
  getAvatar,
  getConfig,
  getConfigForAdmin,
  getFuncVersion,
  getMailMd5,
  getPasswordStatus,
  getQQAvatar,
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
import { getMd5, getSha256, setCustomLibs } from 'twikoo-func/utils/lib';
import logger from 'twikoo-func/utils/logger';
import { emailTest, sendNotice } from 'twikoo-func/utils/notify';
import { postCheckSpam } from 'twikoo-func/utils/spam';
import twikooFuncPkg from 'twikoo-func/package.json';

import { mailShim } from './shims/mail';
import { sanitizeShim } from './shims/sanitize';

setCustomLibs({
  DOMPurify: sanitizeShim,
  nodemailer: mailShim,
});

export const VERSION: string = twikooFuncPkg.version;

// `getMd5()` / `getSha256()` are factories — cache once for stable references.
export const md5 = getMd5();
export const sha256 = getSha256();

// Upstream helpers return `{code, ...payload}`; dispatch wraps with `code: 0`,
// so handlers must strip the inner field to avoid double-wrapping.
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
  getQQAvatar,
  getUrlsQuery,
  isQQ,
  jsonParse,
  logger,
  normalizeMail,
  parseComment,
  postCheckSpam,
  preCheckSpam,
  sendNotice,
  validate,
};
