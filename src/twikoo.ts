// Single boundary against twikoo-func; setCustomLibs runs at module load.

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
import { getMd5, getSha256, setCustomLibs } from 'twikoo-func/utils/lib';
import logger from 'twikoo-func/utils/logger';
import { emailTest, sendNotice } from 'twikoo-func/utils/notify';
import twikooFuncPkg from 'twikoo-func/package.json';

import { mailShim } from './shims/mail';
import { sanitizeShim } from './shims/sanitize';

// Must run before any twikoo-func code path resolves DOMPurify / nodemailer —
// hence top-level (import-order matters); sanitizeShim and mailShim are V8-safe.
setCustomLibs({
  DOMPurify: sanitizeShim,
  nodemailer: mailShim,
});

export const VERSION: string = twikooFuncPkg.version;

// getMd5() / getSha256() are factories — cache once for stable references.
export const md5 = getMd5();
export const sha256 = getSha256();

// Strip the inner `code` so dispatch's outer `code: 0` doesn't double-wrap.
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
  parseComment,
  preCheckSpam,
  sendNotice,
  validate,
};
