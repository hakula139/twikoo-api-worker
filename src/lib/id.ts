import type { CommentId } from '@/types';

import { mkCommentId } from '@/types';

// The Twikoo `_id` is a dashless UUID. Matches twikoo-func's existing rows so frontend deeplinks and
// admin tooling don't need a format branch.
export const newCommentId = (): CommentId => mkCommentId(crypto.randomUUID().replace(/-/g, ''));
