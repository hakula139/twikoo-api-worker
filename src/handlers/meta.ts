import type { Handler } from '../types';

import { VERSION, getFuncVersion as getFuncVersionFn, stripCode } from '../twikoo';

export const getFuncVersion: Handler<'GET_FUNC_VERSION'> = async () =>
  stripCode(getFuncVersionFn({ VERSION }));
