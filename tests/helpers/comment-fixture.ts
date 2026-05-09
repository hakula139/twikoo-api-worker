import type { JsonString } from '@/types';
import type { NewComment } from '@/db';

import { mkCommentId } from '@/types';

// Sensible defaults for required NOT NULL columns. Tests override the fields
// that matter for the assertion under test.
let counter = 0;

export const newComment = (overrides: Partial<NewComment> = {}): NewComment => {
  counter += 1;
  const id = `c${counter.toString().padStart(4, '0')}`;
  return {
    _id: mkCommentId(id),
    uid: 'guest-uid',
    nick: 'guest',
    mail: '',
    mailMd5: '',
    link: '',
    ua: 'Mozilla/5.0',
    ip: '1.2.3.4',
    ipRegion: '',
    master: 0,
    url: '/post',
    href: '',
    comment: 'hi',
    pid: '',
    rid: '',
    isSpam: 0,
    created: 1_700_000_000_000 + counter,
    updated: 1_700_000_000_000 + counter,
    ups: '[]' as JsonString<string[]>,
    downs: '[]' as JsonString<string[]>,
    top: 0,
    avatar: '',
    ...overrides,
  };
};

export const resetCommentCounter = (): void => {
  counter = 0;
};
