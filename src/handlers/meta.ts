import type { Handler } from '@/types';

import { stripCode } from '@/lib/twikoo-response';
import { VERSION, getFuncVersion as getFuncVersionFn } from '@/twikoo';

export const getFuncVersion: Handler<'GET_FUNC_VERSION'> = () =>
  stripCode(getFuncVersionFn(VERSION));
