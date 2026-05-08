// Ambient types for twikoo-func — only the surface we consume.

declare module 'twikoo-func/utils/lib' {
  export function setCustomLibs(libs: {
    DOMPurify?: { sanitize: (input: string) => string };
    nodemailer?: { createTransport: (config: unknown) => unknown };
  }): void;
  export function getMd5(): (input: string) => string;
  export function getSha256(): (input: string) => string;
  export function getCheerio(): unknown;
  export function getXml2js(): {
    parseStringPromise: (xml: string) => Promise<unknown>;
  };
}

declare module 'twikoo-func/utils' {
  export function getFuncVersion(opts: { VERSION: string }): {
    code: number;
    data?: { version: string };
    version?: string;
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
  ): Promise<{ code: number; status?: number; version?: string; message?: string }>;
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
  export function sendNotice(
    comment: unknown,
    config: unknown,
    getParentComment: (current: unknown) => Promise<unknown>,
  ): Promise<void>;
  export function emailTest(
    event: unknown,
    config: unknown,
    isAdmin: boolean,
  ): Promise<{ code: number; data?: unknown; message?: string }>;
}

declare module 'twikoo-func/utils/image' {
  export function uploadImage(
    event: unknown,
    config: unknown,
  ): Promise<{ code: number; data?: unknown; message?: string }>;
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

declare module 'twikoo-func/utils/constants' {
  const constants: {
    RES_CODE: Record<string, number>;
    MAX_REQUEST_TIMES: number;
  };
  export default constants;
}
