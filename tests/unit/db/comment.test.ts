import type { CommentSort, NewComment } from '@/db';
import type { JsonString } from '@/types';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { mkCommentId } from '@/types';
import { newComment, resetCommentCounter } from '@tests/helpers/comment-fixture';
import { applyTestSchema, dbInstance, resetTestDb } from '@tests/helpers/db';

beforeAll(async () => {
  await applyTestSchema();
});

beforeEach(async () => {
  await resetTestDb();
  resetCommentCounter();
});

const seed = async (rows: NewComment[]): Promise<void> => {
  const db = dbInstance();
  await db.comment.saveMany(rows);
};

describe('CommentDB.byId', () => {
  it('returns the row when present', async () => {
    const row = newComment({ _id: mkCommentId('comment-1'), comment: '感谢分享。' });
    await seed([row]);

    const db = dbInstance();
    const fetched = await db.comment.byId(mkCommentId('comment-1'));
    expect(fetched?.comment).toBe('感谢分享。');
  });

  it('returns undefined when missing', async () => {
    const db = dbInstance();
    expect(await db.comment.byId(mkCommentId('missing'))).toBeUndefined();
  });
});

describe('CommentDB.save', () => {
  it('inserts a single row that byId can read back', async () => {
    const db = dbInstance();
    await db.comment.save(newComment({ _id: mkCommentId('once'), comment: 'solo' }));

    const fetched = await db.comment.byId(mkCommentId('once'));
    expect(fetched?.comment).toBe('solo');
  });
});

describe('CommentDB.count > visibility', () => {
  it('counts only non-spam top-level comments by default (showAll=false)', async () => {
    await seed([
      newComment({ url: '/p', isSpam: 0 }),
      newComment({ url: '/p', isSpam: 1 }),
      newComment({ url: '/p', isSpam: 0, rid: 'parent' }),
    ]);

    const db = dbInstance();
    expect(await db.comment.count(['/p'], false, 'guest')).toBe(1);
  });

  it('shows the caller their own spam comments (showAll=false)', async () => {
    await seed([
      newComment({ url: '/p', isSpam: 1, uid: 'me' }),
      newComment({ url: '/p', isSpam: 1, uid: 'someone-else' }),
    ]);

    const db = dbInstance();
    expect(await db.comment.count(['/p'], false, 'me')).toBe(1);
  });

  it('returns every top-level row when showAll=true regardless of spam / uid', async () => {
    await seed([
      newComment({ url: '/p', isSpam: 0 }),
      newComment({ url: '/p', isSpam: 1 }),
      newComment({ url: '/p', isSpam: 1, uid: 'someone-else' }),
    ]);

    const db = dbInstance();
    expect(await db.comment.count(['/p'], true, 'me')).toBe(3);
  });

  it('short-circuits to 0 on an empty urls array', async () => {
    await seed([newComment({ url: '/p' })]);
    const db = dbInstance();
    expect(await db.comment.count([], false, 'me')).toBe(0);
  });
});

describe('CommentDB short-circuits on empty inputs', () => {
  it('list returns [] without hitting D1 when urls is empty', async () => {
    await seed([newComment({ url: '/p' })]);
    const db = dbInstance();
    expect(await db.comment.list([], false, 'me', 9_999_999_999_999, 0, 10)).toEqual([]);
  });

  it('countByUrls returns an empty map when urls is empty', async () => {
    await seed([newComment({ url: '/p' })]);
    const db = dbInstance();
    const map = await db.comment.countByUrls([], false);
    expect(map.size).toBe(0);
  });
});

describe('CommentDB.list > orderClause', () => {
  const seedOrdered = async (): Promise<void> => {
    await seed([
      newComment({
        _id: mkCommentId('older-popular'),
        url: '/p',
        created: 100,
        ups: '["reader-1","reader-2"]' as JsonString<string[]>,
      }),
      newComment({
        _id: mkCommentId('newest-without-votes'),
        url: '/p',
        created: 200,
        ups: '[]' as JsonString<string[]>,
      }),
      newComment({
        _id: mkCommentId('newer-popular'),
        url: '/p',
        created: 150,
        ups: '["reader-1","reader-2"]' as JsonString<string[]>,
      }),
    ]);
  };

  const ids = (sort: CommentSort) =>
    dbInstance()
      .comment.list(['/p'], false, 'guest', 9_999_999_999_999, 0, 10, sort)
      .then((rows) => rows.map((r) => r._id));

  it('newest sorts by created desc', async () => {
    await seedOrdered();
    expect(await ids('newest')).toEqual(['newest-without-votes', 'newer-popular', 'older-popular']);
  });

  it('oldest sorts by created asc', async () => {
    await seedOrdered();
    expect(await ids('oldest')).toEqual(['older-popular', 'newer-popular', 'newest-without-votes']);
  });

  it('popular sorts by ups length desc with created desc as tiebreak', async () => {
    await seedOrdered();
    expect(await ids('popular')).toEqual([
      'newer-popular',
      'older-popular',
      'newest-without-votes',
    ]);
  });

  it('respects the `before` cursor (strict <)', async () => {
    await seedOrdered();
    const rows = await dbInstance().comment.list(['/p'], false, 'guest', 200, 0, 10, 'newest');
    expect(rows.map((r) => r._id)).toEqual(['newer-popular', 'older-popular']);
  });

  it('separates top=1 from top=0', async () => {
    await seed([
      newComment({ _id: mkCommentId('top1'), url: '/p', top: 1 }),
      newComment({ _id: mkCommentId('top2'), url: '/p', top: 0 }),
    ]);
    const db = dbInstance();
    const tops = await db.comment.list(['/p'], false, 'guest', 9_999_999_999_999, 1, 10);
    expect(tops.map((r) => r._id)).toEqual(['top1']);
  });
});

describe('CommentDB.replies', () => {
  it('returns descendants whose rid matches a head id', async () => {
    await seed([
      newComment({ _id: mkCommentId('head'), url: '/p', rid: '' }),
      newComment({ _id: mkCommentId('r1'), url: '/p', pid: 'head', rid: 'head' }),
      newComment({ _id: mkCommentId('r2'), url: '/p', pid: 'r1', rid: 'head' }),
      newComment({ _id: mkCommentId('other'), url: '/p', rid: 'unrelated' }),
    ]);

    const db = dbInstance();
    const replies = await db.comment.replies(['/p'], false, 'guest', ['head']);
    expect(replies.map((r) => r._id).sort()).toEqual(['r1', 'r2']);
  });

  it('returns nothing when rids is empty', async () => {
    await seed([newComment({ url: '/p' })]);
    const db = dbInstance();
    expect(await db.comment.replies(['/p'], false, 'guest', [])).toEqual([]);
  });

  it("hides another author's spam replies while retaining the caller's own", async () => {
    await seed([
      newComment({ _id: mkCommentId('head'), url: '/p' }),
      newComment({ _id: mkCommentId('clean-reply'), url: '/p', rid: 'head', uid: 'reader-1' }),
      newComment({
        _id: mkCommentId('hidden-reply'),
        url: '/p',
        rid: 'head',
        uid: 'reader-2',
        isSpam: 1,
      }),
      newComment({
        _id: mkCommentId('own-reply'),
        url: '/p',
        rid: 'head',
        uid: 'reader-1',
        isSpam: 1,
      }),
    ]);

    const db = dbInstance();
    const visible = await db.comment.replies(['/p'], false, 'reader-1', ['head']);
    expect(visible.map((row) => row._id).sort()).toEqual(['clean-reply', 'own-reply']);

    const all = await db.comment.replies(['/p'], true, 'admin', ['head']);
    expect(all.map((row) => row._id).sort()).toEqual(['clean-reply', 'hidden-reply', 'own-reply']);
  });
});

describe('CommentDB.countByUrls', () => {
  it('groups counts per URL variant and excludes spam', async () => {
    await seed([
      newComment({ url: '/p' }),
      newComment({ url: '/p' }),
      newComment({ url: '/p/' }),
      newComment({ url: '/p', isSpam: 1 }),
    ]);

    const db = dbInstance();
    const map = await db.comment.countByUrls(['/p', '/p/'], false);
    expect(map.get('/p')).toBe(2);
    expect(map.get('/p/')).toBe(1);
  });

  it('includes replies when includeReply=true', async () => {
    await seed([newComment({ url: '/p', rid: '' }), newComment({ url: '/p', rid: 'parent' })]);

    const db = dbInstance();
    expect((await db.comment.countByUrls(['/p'], false)).get('/p')).toBe(1);
    expect((await db.comment.countByUrls(['/p'], true)).get('/p')).toBe(2);
  });
});

describe('CommentDB.recent', () => {
  it('returns the latest non-spam top-level comments across all urls when urls is undefined', async () => {
    await seed([
      newComment({ url: '/a', created: 100 }),
      newComment({ url: '/b', created: 200 }),
      newComment({ url: '/c', isSpam: 1, created: 300 }),
    ]);

    const db = dbInstance();
    const rows = await db.comment.recent(undefined, false, 10);
    expect(rows.map((r) => r.url)).toEqual(['/b', '/a']);
  });

  it('respects the limit', async () => {
    await seed([
      newComment({ _id: mkCommentId('oldest'), url: '/a', created: 100 }),
      newComment({ _id: mkCommentId('middle'), url: '/a', created: 200 }),
      newComment({ _id: mkCommentId('newest'), url: '/a', created: 300 }),
    ]);
    const db = dbInstance();
    const rows = await db.comment.recent(['/a'], false, 2);
    expect(rows.map((row) => row._id)).toEqual(['newest', 'middle']);
  });
});

describe('CommentDB rate-limit counters', () => {
  it('countSince counts comments with created strictly greater than the cursor', async () => {
    await seed([
      newComment({ created: 1000 }),
      newComment({ created: 2000 }),
      newComment({ created: 3000 }),
    ]);
    const db = dbInstance();
    expect(await db.comment.countSince(2000)).toBe(1);
    expect(await db.comment.countSince(0)).toBe(3);
  });

  it('countSinceByIp filters by IP and the same cursor semantics', async () => {
    await seed([
      newComment({ ip: '1.1.1.1', created: 2000 }),
      newComment({ ip: '1.1.1.1', created: 3000 }),
      newComment({ ip: '2.2.2.2', created: 3000 }),
    ]);
    const db = dbInstance();
    expect(await db.comment.countSinceByIp(1500, '1.1.1.1')).toBe(2);
    expect(await db.comment.countSinceByIp(2500, '1.1.1.1')).toBe(1);
  });
});

describe('CommentDB.saveMany', () => {
  it('chunks across the D1 100-placeholder budget without losing rows', async () => {
    const ids = Array.from(
      { length: 13 },
      (_, index) => `batch-${String(index + 1).padStart(2, '0')}`,
    );
    const rows = ids.map((id) => newComment({ _id: mkCommentId(id) }));
    await seed(rows);

    const db = dbInstance();
    const all = await db.comment.exportAll();
    expect(all.map((row) => row._id).sort()).toEqual(ids);
  });

  it('is a no-op for an empty array', async () => {
    const db = dbInstance();
    await db.comment.saveMany([]);
    expect(await db.comment.exportAll()).toHaveLength(0);
  });
});

describe('CommentDB.toggleVote', () => {
  const seedHead = async (id: string, ups = '[]', downs = '[]') => {
    await seed([
      newComment({
        _id: mkCommentId(id),
        ups: ups as JsonString<string[]>,
        downs: downs as JsonString<string[]>,
      }),
    ]);
  };

  it('adds the voter to ups on first up-vote', async () => {
    await seedHead('c1');
    const db = dbInstance();
    expect(await db.comment.toggleVote(mkCommentId('c1'), 'voter', 'up')).toBe(true);

    const row = await db.comment.byId(mkCommentId('c1'));
    expect(JSON.parse(row?.ups ?? '[]')).toEqual(['voter']);
  });

  it('removes the voter from ups on a second up-vote (toggle off)', async () => {
    await seedHead('c1', '["voter"]');
    const db = dbInstance();
    await db.comment.toggleVote(mkCommentId('c1'), 'voter', 'up');

    const row = await db.comment.byId(mkCommentId('c1'));
    expect(JSON.parse(row?.ups ?? '[]')).toEqual([]);
  });

  it('flips a down-vote into an up-vote (moves voter between arrays)', async () => {
    await seedHead('c1', '[]', '["voter"]');
    const db = dbInstance();
    await db.comment.toggleVote(mkCommentId('c1'), 'voter', 'up');

    const row = await db.comment.byId(mkCommentId('c1'));
    expect(JSON.parse(row?.ups ?? '[]')).toEqual(['voter']);
    expect(JSON.parse(row?.downs ?? '[]')).toEqual([]);
  });

  it('returns false when no row matches the id', async () => {
    const db = dbInstance();
    expect(await db.comment.toggleVote(mkCommentId('missing'), 'voter', 'up')).toBe(false);
  });
});

describe('CommentDB.updateSpam / update / delete', () => {
  it('updateSpam flips isSpam and bumps updated', async () => {
    await seed([newComment({ _id: mkCommentId('c1'), isSpam: 0, updated: 1 })]);
    const db = dbInstance();
    await db.comment.updateSpam(mkCommentId('c1'), 1, 9999);

    const row = await db.comment.byId(mkCommentId('c1'));
    expect(row?.isSpam).toBe(1);
    expect(row?.updated).toBe(9999);
  });

  it('update writes only the supplied fields', async () => {
    await seed([newComment({ _id: mkCommentId('c1'), comment: 'old', top: 0 })]);
    const db = dbInstance();
    await db.comment.update(mkCommentId('c1'), { comment: 'new' });

    const row = await db.comment.byId(mkCommentId('c1'));
    expect(row?.comment).toBe('new');
    expect(row?.top).toBe(0);
  });

  it('delete removes the row', async () => {
    await seed([newComment({ _id: mkCommentId('c1') })]);
    const db = dbInstance();
    await db.comment.delete(mkCommentId('c1'));

    expect(await db.comment.byId(mkCommentId('c1'))).toBeUndefined();
  });
});

describe('CommentDB admin views', () => {
  it('countForAdmin / listForAdmin filter by isSpam', async () => {
    await seed([
      newComment({ isSpam: 0, comment: 'clean' }),
      newComment({ isSpam: 1, comment: 'flagged' }),
    ]);

    const db = dbInstance();
    expect(await db.comment.countForAdmin({ isSpam: 1 })).toBe(1);
    const rows = await db.comment.listForAdmin({ isSpam: 1 }, 10, 0);
    expect(rows.map((r) => r.comment)).toEqual(['flagged']);
  });

  it.each<
    [keyof Pick<NewComment, 'nick' | 'mail' | 'link' | 'ip' | 'comment' | 'url' | 'href'>, string]
  >([
    ['nick', 'Hakula'],
    ['mail', 'reader@example.com'],
    ['link', 'https://example.com/profile'],
    ['ip', '192.0.2.10'],
    ['comment', '感谢分享'],
    ['url', '/about-me/'],
    ['href', 'https://hakula.xyz/about-me/'],
  ])('keyword filter searches the %s column', async (field, value) => {
    const id = mkCommentId(`match-${field}`);
    await seed([
      newComment({ _id: id, [field]: value }),
      newComment({
        _id: mkCommentId('unrelated'),
        nick: 'Another reader',
        mail: 'other@example.net',
        link: 'https://example.net/profile',
        ip: '198.51.100.20',
        comment: 'Different content.',
        url: '/comments/',
        href: 'https://example.net/comments/',
      }),
    ]);

    const db = dbInstance();
    const rows = await db.comment.listForAdmin({ keyword: `%${value}%` }, 10, 0);
    expect(rows.map((row) => row._id)).toEqual([id]);
  });

  // cspell:ignore fooXbar
  it('keyword filter treats _ literally via ESCAPE', async () => {
    await seed([
      newComment({ _id: mkCommentId('lit'), comment: 'foo_bar' }),
      newComment({ _id: mkCommentId('alt'), comment: 'fooXbar' }),
    ]);

    const db = dbInstance();
    const rows = await db.comment.listForAdmin({ keyword: '%foo\\_bar%' }, 10, 0);
    expect(rows.map((r) => r._id)).toEqual(['lit']);
  });

  it('keyword filter treats % literally via ESCAPE', async () => {
    await seed([
      newComment({ _id: mkCommentId('lit'), comment: '50% off' }),
      newComment({ _id: mkCommentId('alt'), comment: '50 fancy off' }),
    ]);

    const db = dbInstance();
    const rows = await db.comment.listForAdmin({ keyword: '%50\\% off%' }, 10, 0);
    expect(rows.map((r) => r._id)).toEqual(['lit']);
  });

  // cspell:ignore pathXfile
  it('keyword filter treats backslash literally via ESCAPE', async () => {
    await seed([
      newComment({ _id: mkCommentId('lit'), comment: 'path\\file' }),
      newComment({ _id: mkCommentId('alt'), comment: 'pathXfile' }),
    ]);

    const db = dbInstance();
    const rows = await db.comment.listForAdmin({ keyword: '%path\\\\file%' }, 10, 0);
    expect(rows.map((r) => r._id)).toEqual(['lit']);
  });

  it('listForAdmin defaults to newest order on the created column', async () => {
    await seed([
      newComment({ _id: mkCommentId('oldest-comment'), created: 100 }),
      newComment({ _id: mkCommentId('newest-comment'), created: 300 }),
      newComment({ _id: mkCommentId('middle-comment'), created: 200 }),
    ]);

    const db = dbInstance();
    const rows = await db.comment.listForAdmin({}, 10, 0);
    expect(rows.map((r) => r._id)).toEqual(['newest-comment', 'middle-comment', 'oldest-comment']);
  });

  it('listForAdmin honors sort=oldest', async () => {
    await seed([
      newComment({ _id: mkCommentId('oldest-comment'), created: 100 }),
      newComment({ _id: mkCommentId('newest-comment'), created: 300 }),
      newComment({ _id: mkCommentId('middle-comment'), created: 200 }),
    ]);

    const db = dbInstance();
    const rows = await db.comment.listForAdmin({}, 10, 0, 'oldest');
    expect(rows.map((r) => r._id)).toEqual(['oldest-comment', 'middle-comment', 'newest-comment']);
  });

  it('listForAdmin honors sort=popular by ups array length', async () => {
    await seed([
      newComment({
        _id: mkCommentId('most-votes'),
        ups: '["reader-1","reader-2","reader-3"]' as JsonString<string[]>,
      }),
      newComment({ _id: mkCommentId('no-votes'), ups: '[]' as JsonString<string[]> }),
      newComment({
        _id: mkCommentId('one-vote'),
        ups: '["reader-1"]' as JsonString<string[]>,
      }),
    ]);

    const db = dbInstance();
    const rows = await db.comment.listForAdmin({}, 10, 0, 'popular');
    expect(rows.map((r) => r._id)).toEqual(['most-votes', 'one-vote', 'no-votes']);
  });
});
