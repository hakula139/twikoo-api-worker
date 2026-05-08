// xss is CJS that re-attaches named exports onto module.exports at runtime;
// vitest's ESM resolver only sees the default callable. Pull through default
// to keep both wrangler's bundler and the test pool happy.
import xssDefault, { type FilterXSS as FilterXSSType } from 'xss';

interface XssNamespace {
  FilterXSS: new (opts: ConstructorParameters<typeof FilterXSSType>[0]) => FilterXSSType;
  getDefaultWhiteList: () => Record<string, string[]>;
}

const { FilterXSS, getDefaultWhiteList } = xssDefault as unknown as XssNamespace;

// Comments are sanitized at write time. Mirror DOMPurify's defaults that the
// upstream widget expects: keep formatting and links, allow images and code
// blocks, drop scripts / iframes / event handlers / `javascript:` URLs.
const TAG_EXTRAS: Record<string, string[]> = {
  img: ['src', 'alt', 'title', 'width', 'height'],
  a: ['href', 'title', 'target', 'rel'],
  pre: ['class'],
  code: ['class'],
  span: ['class', 'style'],
  div: ['class', 'style'],
};

const whiteList = getDefaultWhiteList();
for (const [tag, attrs] of Object.entries(TAG_EXTRAS)) {
  whiteList[tag] = Array.from(new Set([...(whiteList[tag] ?? []), ...attrs]));
}

const filter = new FilterXSS({
  whiteList,
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
  css: false,
});

export const sanitizeHtml = (input: string): string => filter.process(input);
