import { describe, expect, it } from 'vitest';

import { ResponseCode, TwikooError } from '@/lib/errors';

describe('ResponseCode', () => {
  it('pins the upstream-frontend contract values', () => {
    // Frozen values: changing any of these breaks the widget.
    expect(ResponseCode.SUCCESS).toBe(0);
    expect(ResponseCode.NO_PARAM).toBe(100);
    expect(ResponseCode.FAIL).toBe(1000);
    expect(ResponseCode.NEED_LOGIN).toBe(1024);
    expect(ResponseCode.CREDENTIALS_INVALID).toBe(1025);
    expect(ResponseCode.AKISMET_ERROR).toBe(1030);
    expect(ResponseCode.UPLOAD_FAILED).toBe(1040);
    expect(ResponseCode.NSFW_REJECTED).toBe(1041);
    expect(ResponseCode.FORBIDDEN).toBe(1403);
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

  it('is throwable and catchable as TwikooError', () => {
    try {
      throw new TwikooError(ResponseCode.FAIL, 'boom');
    } catch (e) {
      expect(e).toBeInstanceOf(TwikooError);
      expect((e as TwikooError).code).toBe(ResponseCode.FAIL);
    }
  });
});
