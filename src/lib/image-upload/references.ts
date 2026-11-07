import { decodeHTML, decodeHTMLAttribute } from 'entities';

export const collectUploadReferences = async (
  body: string,
  publicUrl: string,
): Promise<Set<string>> => {
  const base = new URL(publicUrl);
  const prefix = `${base.pathname.replace(/\/$/, '')}/`;
  const references = new Set<string>();

  const rememberKey = (key: string, trimPunctuation: boolean) => {
    const suffix = trimPunctuation ? /[.,!?;:)\]}]+$/.exec(key) : null;
    const minimumLength = suffix?.index ?? key.length;
    const bytes = new TextEncoder().encode(key).length;
    let length = key.length - Math.max(0, bytes - 1_024);

    // Trailing prose punctuation is ASCII, so excess bytes skip impossible R2 keys.
    while (length >= minimumLength) {
      references.add(key.slice(0, length));
      length--;
    }
  };

  const rememberUrl = (value: string, trimPunctuation = false) => {
    value = value.trim();
    let url: URL;
    try {
      url = new URL(value.startsWith('//') ? `${base.protocol}${value}` : value);
    } catch {
      return;
    }

    if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) {
      return;
    }

    const key = url.pathname.slice(prefix.length);
    const trimKey = trimPunctuation && !url.search && !url.hash;
    rememberKey(key, trimKey);
    try {
      rememberKey(decodeURIComponent(key), trimKey);
    } catch {
      // A literal percent sign can be part of a migrated object key.
    }
  };

  const rememberText = (value: string) => {
    for (const match of decodeHTML(value).matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      rememberUrl(match[0], true);
    }
  };

  let text = '';
  const response = new HTMLRewriter()
    .on('*', {
      element(element) {
        for (const name of ['src', 'href']) {
          const value = element.getAttribute(name);
          if (value !== null) {
            rememberUrl(decodeHTMLAttribute(value));
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
    .transform(new Response(body));

  await response.arrayBuffer();
  return references;
};
