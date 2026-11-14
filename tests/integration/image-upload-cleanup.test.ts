import type { Env } from '@/types';

import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildDb } from '@/db';
import { commentUpload, upload } from '@/db/schema';
import { createUploadDb } from '@/db/upload';
import { collectUnusedUploads } from '@/lib/image-upload/cleanup';
import { uploadR2 } from '@/lib/image-upload/r2';
import { collectUploadReferences } from '@/lib/image-upload/references';
import worker from '@/worker';
import { newComment, resetCommentCounter } from '@tests/helpers/comment-fixture';
import { applyTestSchema, drizzleClient, resetTestDb } from '@tests/helpers/db';
import { PNG_PHOTO as PHOTO } from '@tests/helpers/image-fixture';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const PUBLIC_URL = 'https://images.example.com/assets';
const bindings: Env = { DB: env.DB, R2: env.R2, R2_PUBLIC_URL: PUBLIC_URL };
const comments = () => buildDb(env.DB, PUBLIC_URL).comment;
const uploads = () => createUploadDb(drizzleClient());
const imageUrl = (key: string) => `${PUBLIC_URL}/${encodeURIComponent(key)}`;
const image = (key: string) => `<img src="${imageUrl(key)}">`;

const readUpload = async (key: string) => {
  const [row] = await drizzleClient().select().from(upload).where(eq(upload.key, key));
  return row;
};

const storeUpload = async (key: string, now = NOW): Promise<void> => {
  await uploads().register(key, now);
  await env.R2.put(key, 'image bytes');
};

beforeAll(applyTestSchema);

afterEach(async () => {
  vi.restoreAllMocks();
  await resetTestDb();
  resetCommentCounter();
  const { objects } = await env.R2.list();
  if (objects.length > 0) {
    await env.R2.delete(objects.map(({ key }) => key));
  }
});

describe('integration: upload registration', () => {
  it('registers an upload before its object write and retains failed writes for cleanup', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    let registeredKey = '';
    vi.spyOn(env.R2, 'put').mockImplementationOnce(async (key) => {
      registeredKey = key;
      expect(await readUpload(key)).toMatchObject({ deleteAfter: NOW + HOUR, deleting: 0 });
      throw new Error('Object write failed.');
    });

    await expect(uploadR2(PHOTO, 'sample.png', bindings)).rejects.toThrow('Object write failed.');

    expect(await readUpload(registeredKey)).toBeDefined();
    await expect(collectUnusedUploads(bindings, NOW + HOUR + 1)).resolves.toEqual({ deleted: 1 });
    expect(await readUpload(registeredKey)).toBeUndefined();
  });

  it('rejects oversized UTF-8 keys before registering or writing an object', async () => {
    const put = vi.spyOn(env.R2, 'put');

    await expect(uploadR2(PHOTO, `${'图'.repeat(350)}.png`, bindings)).rejects.toThrow(
      'Image filename is too long.',
    );

    expect(await drizzleClient().select().from(upload)).toEqual([]);
    expect(put).not.toHaveBeenCalled();
  });
});

describe('integration: comment upload references', () => {
  it('protects shared images in all moderation states until their last reference is removed', async () => {
    await storeUpload('shared.png');
    const first = newComment({ comment: `${image('shared.png')}${image('shared.png')}` });
    const second = newComment({ comment: image('shared.png'), isSpam: 1 });
    await comments().save(first);
    await comments().save(second);
    await comments().updateSpam(first._id, 1, NOW);
    await comments().update(first._id, { nick: 'Another reader' });
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 2 * HOUR);

    await comments().delete(first._id);
    await collectUnusedUploads(bindings, NOW + 3 * HOUR);

    expect(await env.R2.head('shared.png')).not.toBeNull();
    expect(await readUpload('shared.png')).toMatchObject({ deleteAfter: null, deleting: 0 });
    expect(await drizzleClient().select().from(commentUpload)).toEqual([
      { commentId: second._id, uploadKey: 'shared.png', deleting: 0 },
    ]);

    await comments().delete(second._id);

    expect(await readUpload('shared.png')).toMatchObject({ deleteAfter: NOW + 3 * HOUR });
    await expect(collectUnusedUploads(bindings, NOW + 3 * HOUR)).resolves.toEqual({ deleted: 0 });
    await expect(collectUnusedUploads(bindings, NOW + 3 * HOUR + 1)).resolves.toEqual({
      deleted: 1,
    });
    expect(await env.R2.head('shared.png')).toBeNull();
  });

  it('moves references on body edits and protects imports across insertion chunks', async () => {
    const keys = Array.from({ length: 6 }, (_, index) => `import-${index}.png`);
    await Promise.all(keys.map((key) => storeUpload(key)));
    const rows = keys.map((key, index) =>
      newComment({ comment: image(key), isSpam: index % 2 ? 1 : 0 }),
    );
    await comments().saveMany(rows);
    await comments().update(rows[5]._id, { nick: 'Updated reader' });
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 2 * HOUR);

    await comments().update(rows[0]._id, { comment: image(keys[1]) });
    await collectUnusedUploads(bindings, NOW + 3 * HOUR + 1);

    expect(await env.R2.head(keys[0])).toBeNull();
    for (const key of keys.slice(1)) {
      expect(await env.R2.head(key), key).not.toBeNull();
      expect(await readUpload(key), key).toMatchObject({ deleteAfter: null });
    }
  });

  it.each([
    {
      name: 'image source',
      key: 'folder/photo.png',
      body: '<img src="https://images.example.com/assets/folder/photo.png">',
      protected: true,
    },
    {
      name: 'link and entities',
      key: 'a&b.png',
      body: '<a href="https://images.example.com/assets/a&amp;b.png?download=1#preview">image</a>',
      protected: true,
    },
    {
      name: 'encoded Unicode and spaces',
      key: '图 片.png',
      body: '<img src="https://images.example.com/assets/%E5%9B%BE%20%E7%89%87.png">',
      protected: true,
    },
    {
      name: 'numeric supplementary entity',
      key: 'face😀.png',
      body: '<img src="https://images.example.com/assets/face&#x1F600;.png">',
      protected: true,
    },
    {
      name: 'protocol-relative source',
      key: 'relative.png',
      body: '<img src=" //images.example.com/assets/relative.png">',
      protected: true,
    },
    {
      name: 'uppercase protocol in text',
      key: 'upper.png',
      body: 'HTTPS://images.example.com/assets/upper.png',
      protected: true,
    },
    {
      name: 'literal percent',
      key: 'literal%20.png',
      body: '<img src="https://images.example.com/assets/literal%2520.png">',
      protected: true,
    },
    {
      name: 'plain URL punctuation',
      key: 'plain.png',
      body: 'See (https://images.example.com/assets/plain.png).',
      protected: true,
    },
    {
      name: 'literal punctuation',
      key: 'literal.png).',
      body: 'https://images.example.com/assets/literal.png).',
      protected: true,
    },
    {
      name: 'foreign origin',
      key: 'foreign.png',
      body: '<img src="https://images.example.com.evil.test/assets/foreign.png">',
      protected: false,
    },
    {
      name: 'different prefix',
      key: 'prefix.png',
      body: '<img src="https://images.example.com/assets-other/prefix.png">',
      protected: false,
    },
    {
      name: 'decode once',
      key: 'once name.png',
      body: '<img src="https://images.example.com/assets/once%2520name.png">',
      protected: false,
    },
  ])('normalizes $name references', async ({ key, body, protected: preserved }) => {
    await storeUpload(key);
    await buildDb(env.DB, `${PUBLIC_URL}/`).comment.save(newComment({ comment: body }));

    await collectUnusedUploads(bindings, NOW + HOUR + 1);

    expect((await env.R2.head(key)) !== null).toBe(preserved);
  });

  it('bounds long punctuation candidates while retaining the referenced image', async () => {
    const body = `${imageUrl('longtail.png')}${'.'.repeat(10_000)}`;
    await storeUpload('longtail.png');

    const references = await collectUploadReferences(body, PUBLIC_URL);
    await comments().save(newComment({ comment: body }));
    await collectUnusedUploads(bindings, NOW + HOUR + 1);

    expect(await env.R2.head('longtail.png')).not.toBeNull();
    expect(references.has('longtail.png')).toBe(true);
    expect(references.size).toBeLessThanOrEqual(1_024);
    for (const key of references) {
      expect(new TextEncoder().encode(key).length).toBeLessThanOrEqual(1_024);
    }
  });

  it('orders references and cleanup claims through real D1 constraints', async () => {
    await storeUpload('attached.png');
    await storeUpload('claimed.png');
    const attached = newComment({ comment: image('attached.png') });
    await comments().save(attached);
    const rejected = newComment({ comment: image('claimed.png') });

    expect(await uploads().claimDue(NOW + HOUR + 1)).toEqual(['claimed.png']);
    await expect(
      drizzleClient().update(upload).set({ deleting: 1 }).where(eq(upload.key, 'attached.png')),
    ).rejects.toThrow();
    await expect(comments().save(rejected)).rejects.toThrow('Please upload it again.');
    await expect(
      comments().update(attached._id, { comment: image('claimed.png'), nick: 'Changed' }),
    ).rejects.toThrow('Please upload it again.');
    const imported = [newComment(), newComment({ comment: image('claimed.png') })];
    await expect(comments().saveMany(imported)).rejects.toThrow('Please upload it again.');

    expect(await comments().byId(attached._id)).toMatchObject({
      comment: image('attached.png'),
      nick: attached.nick,
    });
    expect(await comments().byId(rejected._id)).toBeUndefined();
    for (const row of imported) {
      expect(await comments().byId(row._id)).toBeUndefined();
    }
    expect(await readUpload('attached.png')).toMatchObject({ deleteAfter: null });
    expect(await drizzleClient().select().from(commentUpload)).toEqual([
      { commentId: attached._id, uploadKey: 'attached.png', deleting: 0 },
    ]);

    await collectUnusedUploads(bindings, NOW + HOUR + 1);
    const stale = newComment({ comment: image('claimed.png') });
    await comments().save(stale);

    expect(await comments().byId(stale._id)).toMatchObject({ comment: image('claimed.png') });
    expect(await env.R2.head('attached.png')).not.toBeNull();
  });
});

describe('integration: queued upload cleanup', () => {
  it('uses the scheduled event time and retains the exact one-hour boundary', async () => {
    await storeUpload('boundary.png');
    const controller = createScheduledController({ scheduledTime: new Date(NOW + HOUR) });

    await worker.scheduled(controller, bindings);

    expect(await env.R2.head('boundary.png')).not.toBeNull();

    await worker.scheduled(
      createScheduledController({ scheduledTime: new Date(NOW + HOUR + 1) }),
      bindings,
    );

    expect(await env.R2.head('boundary.png')).toBeNull();
    expect(await readUpload('boundary.png')).toBeUndefined();
  });

  it('drains overdue work in bounded batches while preserving unregistered objects', async () => {
    const keys = Array.from({ length: 101 }, (_, index) => `backlog-${index}.png`);
    await Promise.all(keys.map((key) => storeUpload(key)));
    await env.R2.put('legacy.png', 'legacy image');
    const list = vi.spyOn(env.R2, 'list');
    const remove = vi.spyOn(env.R2, 'delete');

    await expect(collectUnusedUploads(bindings, NOW + 48 * HOUR)).resolves.toEqual({
      deleted: 100,
    });

    expect(list).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
    const remaining = await drizzleClient().select().from(upload);
    expect((await env.R2.list()).objects.map(({ key }) => key).sort()).toEqual(
      ['legacy.png', ...remaining.map(({ key }) => key)].sort(),
    );

    await expect(collectUnusedUploads(bindings, NOW + 48 * HOUR)).resolves.toEqual({ deleted: 1 });

    expect((await env.R2.list()).objects.map(({ key }) => key)).toEqual(['legacy.png']);
    expect(await drizzleClient().select().from(upload)).toEqual([]);
  });

  it.each(['object deletion', 'registry completion'])(
    'retries failed %s without losing queued work',
    async (failure) => {
      await storeUpload('retry.png');
      if (failure === 'object deletion') {
        vi.spyOn(env.R2, 'delete').mockRejectedValueOnce(new Error('Deletion failed.'));
      } else {
        const prepare = env.DB.prepare.bind(env.DB);
        vi.spyOn(env.DB, 'prepare').mockImplementation((query) => {
          if (query.startsWith('delete from "upload"')) {
            throw new Error('Completion failed.');
          }
          return prepare(query);
        });
      }

      await expect(collectUnusedUploads(bindings, NOW + HOUR + 1)).rejects.toThrow();

      expect(await readUpload('retry.png')).toMatchObject({ deleting: 1 });
      expect((await env.R2.head('retry.png')) !== null).toBe(failure === 'object deletion');
      vi.restoreAllMocks();

      await expect(collectUnusedUploads(bindings, NOW + HOUR + 1)).resolves.toEqual({ deleted: 1 });

      expect(await env.R2.head('retry.png')).toBeNull();
      expect(await readUpload('retry.png')).toBeUndefined();
    },
  );
});
