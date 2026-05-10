// Frontend contract: values must match upstream twikoo-func constants verbatim.
export const ResponseCode = {
  SUCCESS: 0,
  NO_PARAM: 100,
  FAIL: 1000,
  EVENT_NOT_EXIST: 1001,
  PASS_EXIST: 1010,
  CONFIG_NOT_EXIST: 1020,
  CREDENTIALS_NOT_EXIST: 1021,
  PASS_NOT_EXIST: 1022,
  PASS_NOT_MATCH: 1023,
  NEED_LOGIN: 1024,
  CREDENTIALS_INVALID: 1025,
  AKISMET_ERROR: 1030,
  UPLOAD_FAILED: 1040,
  NSFW_REJECTED: 1041,
  FORBIDDEN: 1403,
} as const;

type ResponseCodeName = keyof typeof ResponseCode;

export type ResponseCodeValue = (typeof ResponseCode)[ResponseCodeName];

// Throw inside a handler to short-circuit with a curated non-SUCCESS response.
export class TwikooError extends Error {
  readonly code: ResponseCodeValue;

  constructor(code: ResponseCodeValue, message: string) {
    super(message);
    this.code = code;
    this.name = 'TwikooError';
  }
}
