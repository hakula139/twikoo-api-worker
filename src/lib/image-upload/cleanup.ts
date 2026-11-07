import type { CommentId, Env } from '../../types';

import xss from 'xss';

import { buildDb } from '../../db';

const { friendlyAttrValue } = xss as unknown as {
  friendlyAttrValue: (value: string) => string;
};

const PAGE_SIZE = 1_000;
const UPLOAD_LIFETIME_MS = 86_400_000;

export const collectUploadReferences = async (env: Env): Promise<Set<string>> => {
  const base = new URL(env.R2_PUBLIC_URL);
  const prefix = `${base.pathname.replace(/\/$/, '')}/`;
  const references = new Set<string>();
  const comments = buildDb(env.DB).comment;

  const rememberUrl = (value: string) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return;
    }

    if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) {
      return;
    }

    const key = url.pathname.slice(prefix.length);
    references.add(key);
    try {
      references.add(decodeURIComponent(key));
    } catch {
      // A literal percent sign can be part of a migrated object key.
    }
  };

  const rememberText = (value: string) => {
    for (const match of friendlyAttrValue(value).matchAll(/https?:\/\/[^\s<>"']+/g)) {
      let candidate = match[0];
      rememberUrl(candidate);

      // Prose punctuation and Markdown closers can also be literal key characters.
      while (/[.,!?;:)\]}]$/.test(candidate)) {
        candidate = candidate.slice(0, -1);
        rememberUrl(candidate);
      }
    }
  };

  let after: CommentId | undefined;
  for (;;) {
    const page = await comments.bodiesAfter(after, PAGE_SIZE);
    if (page.length === 0) {
      return references;
    }

    for (const row of page) {
      let text = '';
      const response = new HTMLRewriter()
        .on('*', {
          element(element) {
            for (const name of ['src', 'href']) {
              const value = element.getAttribute(name);
              if (value !== null) {
                rememberUrl(friendlyAttrValue(value));
              }
            }
          },
        })
        .onDocument({
          text(chunk) {
            text += chunk.text;
            if (chunk.lastInTextNode) {
              rememberText(text);
              text = '';
            }
          },
        })
        .transform(new Response(row.comment));

      await response.arrayBuffer();
      after = row._id;
    }
  }
};

export const collectUnusedUploads = async (env: Env, scheduledTime: number) => {
  const cutoff = scheduledTime - UPLOAD_LIFETIME_MS;
  let references = await collectUploadReferences(env);
  const result = { scanned: 0, deleted: 0, deletedBytes: 0 };
  let cursor: string | undefined;

  for (;;) {
    const page = await env.R2.list({ limit: PAGE_SIZE, cursor });
    result.scanned += page.objects.length;
    const candidates = page.objects.filter(
      (object) => object.uploaded.getTime() < cutoff && !references.has(object.key),
    );

    if (candidates.length > 0) {
      references = await collectUploadReferences(env);
      const unused = candidates.filter((object) => !references.has(object.key));
      if (unused.length > 0) {
        await env.R2.delete(unused.map((object) => object.key));
        result.deleted += unused.length;
        result.deletedBytes += unused.reduce((total, object) => total + object.size, 0);
      }
    }

    if (!page.truncated) {
      return result;
    }

    cursor = page.cursor;
  }
};
