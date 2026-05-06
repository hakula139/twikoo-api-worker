// Twikoo wire-protocol response codes. Numerical values are part of the
// frontend contract — the embedded `twikoo` widget switches on these — so
// they must match the upstream `twikoo-func` constants verbatim.
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

export type ResponseCodeName = keyof typeof ResponseCode;

// Throw inside any handler to short-circuit with a non-SUCCESS response.
// `worker.ts` catches at the top level and maps to a Twikoo JSON envelope.
// Any non-TwikooError thrown is logged and reported as FAIL.
export class TwikooError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = 'TwikooError';
  }
}
