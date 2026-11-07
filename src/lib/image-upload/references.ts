import xss from 'xss';

const { friendlyAttrValue } = xss as unknown as {
  friendlyAttrValue: (value: string) => string;
};

export const collectUploadReferences = async (
  body: string,
  publicUrl: string,
): Promise<Set<string>> => {
  const base = new URL(publicUrl);
  const prefix = `${base.pathname.replace(/\/$/, '')}/`;
  const references = new Set<string>();

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
    .transform(new Response(body));

  await response.arrayBuffer();
  return references;
};
