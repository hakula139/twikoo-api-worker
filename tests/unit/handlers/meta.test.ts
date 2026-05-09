import { describe, expect, it, vi } from 'vitest';

import { getFuncVersion } from '@/handlers/meta';
import * as twikoo from '@/twikoo';
import { buildCtx } from '@tests/helpers/ctx';

describe('getFuncVersion', () => {
  it('forwards VERSION to upstream and strips the inner code', async () => {
    vi.mocked(twikoo.getFuncVersion).mockReturnValueOnce({
      code: 0,
      version: '0.0.0-test',
    });

    const result = await getFuncVersion({}, buildCtx());

    expect(twikoo.getFuncVersion).toHaveBeenCalledWith({ VERSION: twikoo.VERSION });
    expect(result).toEqual({ version: '0.0.0-test' });
  });
});
