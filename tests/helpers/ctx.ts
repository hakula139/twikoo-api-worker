import type { RequestCtx } from '@/types';

import { mkIp, mkUid } from '@/types';

const defaultCtx = (): RequestCtx => ({
  env: {} as RequestCtx['env'],
  request: new Request('https://twikoo.hakula.xyz/'),
  waitUntil: () => undefined,
  ip: mkIp('192.0.2.1'),
  region: '',
  origin: null,
  uid: mkUid(''),
  config: {},
  db: {} as RequestCtx['db'],
});

export const buildCtx = (overrides: Partial<RequestCtx> = {}): RequestCtx => ({
  ...defaultCtx(),
  ...overrides,
});
