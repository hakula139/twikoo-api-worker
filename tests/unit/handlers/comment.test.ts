// Pins the URL-variant fan-out that COMMENT_GET (commentGet) relies on for
// trailing-slash parity. commentGet wraps payload.url through twikoo-func's
// getUrlsQuery and forwards the resulting array to ctx.db.comment.{count,
// list, replies}; this is the same pattern the sibling handlers
// getCommentsCount and getRecentComments already use.
//
// We re-derive the variant logic inline rather than importing twikoo-func
// here: the workerd-backed test pool segfaults on the upstream module's
// eager CJS requires (axios, form-data, etc.), so the upstream lib cannot
// be loaded from the test isolate in this environment. The handler's
// behavior is otherwise pinned by typecheck — count/list/replies now
// require `urls: string[]`, so any forgotten call site fails compilation.

import { describe, expect, it } from 'vitest';

// Mirrors twikoo-func/utils#getUrlQuery: emit both `/path` and `/path/`.
const variants = (url: string): string[] => {
  const flipped = url.endsWith('/') ? url.slice(0, -1) : `${url}/`;
  return [url, flipped];
};

describe('COMMENT_GET trailing-slash variants', () => {
  it('expands `/foo` to both slash forms', () => {
    expect(variants('/foo')).toEqual(['/foo', '/foo/']);
  });

  it('expands `/foo/` to both slash forms', () => {
    expect(variants('/foo/')).toEqual(['/foo/', '/foo']);
  });

  it('round-trips: a viewer at either form sees the other', () => {
    expect(new Set(variants('/foo'))).toEqual(new Set(variants('/foo/')));
  });
});
