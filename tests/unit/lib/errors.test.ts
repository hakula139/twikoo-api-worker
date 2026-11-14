import { describe, expect, it } from 'vitest';

import { ResponseCode, TwikooError } from '@/lib/errors';

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
