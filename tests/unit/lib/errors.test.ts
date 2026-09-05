import { describe, expect, it } from 'vitest';

import { ResponseCode, TwikooError } from '@/lib/errors';

describe('ResponseCode', () => {
  it('pins the upstream-frontend contract values', () => {
    expect(ResponseCode).toEqual({
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
    });
  });
});

describe('TwikooError', () => {
  it('carries the code and message and is an Error instance', () => {
    const err = new TwikooError(ResponseCode.NEED_LOGIN, '请先登录');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TwikooError);
    expect(err.code).toBe(ResponseCode.NEED_LOGIN);
    expect(err.message).toBe('请先登录');
    expect(err.name).toBe('TwikooError');
  });
});
