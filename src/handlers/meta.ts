import type { Handler } from '../types';

import { VERSION, getFuncVersion as getFuncVersionFn } from '../twikoo';

export const getFuncVersion: Handler = async () => {
  const { code: _code, ...rest } = getFuncVersionFn({ VERSION });
  return rest;
};
