import type { Handler } from '../types';

import { VERSION, getFuncVersion as getFuncVersionFn, stripCode } from '../twikoo';

export const getFuncVersion: Handler = async () => stripCode(getFuncVersionFn({ VERSION }));
