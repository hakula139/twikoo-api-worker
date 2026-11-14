declare module 'twikoo-func/utils/constants' {
  export const RES_CODE: {
    readonly SUCCESS: 0;
    readonly NO_PARAM: 100;
    readonly FAIL: 1000;
    readonly EVENT_NOT_EXIST: 1001;
    readonly PASS_EXIST: 1010;
    readonly CONFIG_NOT_EXIST: 1020;
    readonly CREDENTIALS_NOT_EXIST: 1021;
    readonly CREDENTIALS_INVALID: 1025;
    readonly PASS_NOT_EXIST: 1022;
    readonly PASS_NOT_MATCH: 1023;
    readonly NEED_LOGIN: 1024;
    readonly FORBIDDEN: 1403;
    readonly AKISMET_ERROR: 1030;
    readonly UPLOAD_FAILED: 1040;
    readonly NSFW_REJECTED: 1041;
  };
}

declare module 'twikoo-func/utils/image' {
  import type { Buffer } from 'node:buffer';

  export function parseImage(photo: string): {
    body: Buffer;
    mimeType: string;
    fileName: string;
  };
}

declare module 'twikoo-func/utils/lib' {
  export function setCustomLibs(libs: {
    DOMPurify?: { sanitize: (input: string) => string };
    nodemailer?: { createTransport: (config: unknown) => unknown };
  }): void;
  export function getHtmlToText(): (input: string) => string;
  export function getMd5(): (input: string) => string;
  export function getSha256(): (input: string) => string;
}

declare module 'twikoo-func/utils' {
  export function getFuncVersion(VERSION: string): {
    code: number;
    version: string;
  };
  export function parseComment(
    comments: readonly unknown[],
    uid: string,
    config: unknown,
  ): unknown[];
  export function normalizeMail(mail: string): string;
  export function equalsMail(a: string, b: string): boolean;
  export function getMailMd5(comment: { mail?: string; nick?: string; mailMd5?: string }): string;
  export function getAvatar(
    comment: { avatar?: string; mail?: string; nick?: string; mailMd5?: string },
    config: unknown,
  ): string;
  export function getUrlsQuery(urls: readonly string[]): string[];
  export function isQQ(mail: string): boolean;
  export function addQQMailSuffix(mail: string): string;
  export function getPasswordStatus(
    config: unknown,
    VERSION: string,
  ): Promise<{
    code: number;
    status?: boolean;
    credentials?: boolean;
    version?: string;
    message?: string;
  }>;
  export function preCheckSpam(comment: unknown, config: unknown): boolean;
  export function getConfig(opts: {
    config: unknown;
    VERSION: string;
    isAdmin: boolean;
  }): Promise<{ code: number; config?: unknown; message?: string; version?: string }>;
  export function getConfigForAdmin(opts: {
    config: unknown;
    isAdmin: boolean;
  }): Promise<{ code: number; config?: unknown; message?: string }>;
  export function validate(event: unknown, requiredFields: readonly string[]): void;
}

declare module 'twikoo-func/utils/notify' {
  export function noticeMaster(comment: unknown, config: unknown): Promise<unknown>;
  export function noticeReply(
    comment: unknown,
    config: unknown,
    getParentComment: (current: unknown) => Promise<unknown>,
  ): Promise<unknown>;
  export function sendNotice(
    comment: unknown,
    config: unknown,
    getParentComment: (current: unknown) => Promise<unknown>,
  ): Promise<void>;
  export function emailTest(
    event: unknown,
    config: unknown,
    isAdmin: boolean,
  ): Promise<{ result?: unknown; message?: string }>;
}

declare module 'twikoo-func/utils/import' {
  export function jsonParse(content: string): unknown;
  export function commentImportValine(db: unknown, log: (msg: string) => void): Promise<unknown[]>;
  export function commentImportDisqus(db: unknown, log: (msg: string) => void): Promise<unknown[]>;
  export function commentImportArtalk(db: unknown, log: (msg: string) => void): Promise<unknown[]>;
  export function commentImportArtalk2(db: unknown, log: (msg: string) => void): Promise<unknown[]>;
  export function commentImportTwikoo(db: unknown, log: (msg: string) => void): Promise<unknown[]>;
}

declare module 'twikoo-func/utils/logger' {
  const logger: {
    log(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
  export default logger;
}
