import { describe, expect, it } from 'vitest';

import { newCommentId } from '@/lib/id';

describe('newCommentId', () => {
  it('returns a 32-char lowercase hex string with no dashes', () => {
    const id = newCommentId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns a fresh id on each call', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newCommentId()));
    expect(ids.size).toBe(50);
  });
});
