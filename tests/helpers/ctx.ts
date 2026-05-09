import type { RequestCtx } from '@/types';

import { mkIp, mkUid } from '@/types';

const defaultCtx = (): RequestCtx => ({
  env: {} as RequestCtx['env'],
  request: new Request('https://twikoo.example/'),
  waitUntil: () => undefined,
  ip: mkIp('1.2.3.4'),
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
