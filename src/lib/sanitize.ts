import type { FilterXSS as FilterXSSInstance, IFilterXSSOptions, IWhiteList } from 'xss';

// xss is CJS. Vitest's pool sees only the default callable, so named ESM
// imports throw at runtime. Pull through the default and reuse xss's own types.
import xss from 'xss';

const { FilterXSS, getDefaultWhiteList } = xss as unknown as {
  FilterXSS: new (options?: IFilterXSSOptions) => FilterXSSInstance;
  getDefaultWhiteList: () => IWhiteList;
};

const TAG_EXTRAS: Record<string, string[]> = {
  a: ['rel'],
  code: ['class'],
  div: ['class', 'style'],
  img: ['class'],
  pre: ['class'],
  span: ['class', 'style'],
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
