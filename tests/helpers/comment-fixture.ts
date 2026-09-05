import type { NewComment } from '@/db';
import type { JsonString } from '@/types';

import { mkCommentId } from '@/types';

let counter = 0;

export const newComment = (overrides: Partial<NewComment> = {}): NewComment => {
  counter += 1;
  const id = `c${counter.toString().padStart(4, '0')}`;
  return {
    _id: mkCommentId(id),
    uid: 'reader-1',
    nick: 'Reader',
    mail: '',
    mailMd5: '',
    link: '',
    ua: 'Mozilla/5.0',
    ip: '192.0.2.1',
    ipRegion: '',
    master: 0,
    url: '/about-me/',
    href: 'https://hakula.xyz/about-me/',
    comment: '感谢分享。',
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
