import type { RequestCtx } from '@/types';

const defaultCtx = (): RequestCtx => ({
  env: {} as RequestCtx['env'],
  request: new Request('https://twikoo.example/'),
  waitUntil: () => undefined,
  ip: '1.2.3.4',
  region: '',
  origin: null,
  uid: '',
  config: {},
  db: {} as RequestCtx['db'],
});

export const buildCtx = (overrides: Partial<RequestCtx> = {}): RequestCtx => ({
  ...defaultCtx(),
  ...overrides,
});
