// xss is CJS; vitest's pool sees only the default callable, so named ESM
// imports throw at runtime. Pull through the default and reuse xss's own types.
import xss, {
  type FilterXSS as FilterXSSInstance,
  type IFilterXSSOptions,
  type IWhiteList,
} from 'xss';

const { FilterXSS, getDefaultWhiteList } = xss as unknown as {
  FilterXSS: new (options?: IFilterXSSOptions) => FilterXSSInstance;
  getDefaultWhiteList: () => IWhiteList;
};

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
