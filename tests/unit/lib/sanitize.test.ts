import { describe, expect, it } from 'vitest';

import { sanitizeHtml } from '@/lib/sanitize';

describe('sanitizeHtml', () => {
  it('strips <script> tags and their bodies entirely', () => {
    const out = sanitizeHtml('Before<script>alert(1)</script>after');

    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('Before');
    expect(out).toContain('after');
  });

  it('drops on* event handler attributes from allowed tags', () => {
    const out = sanitizeHtml('<a href="https://example.com" onclick="bad()">link</a>');

    expect(out).not.toContain('onclick');
    expect(out).toContain('href="https://example.com"');
  });

  it('strips javascript: URLs from anchor href', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');

    expect(out).not.toMatch(/javascript:/i);
  });

  it('keeps OWO image attributes and code classes', () => {
    const image =
      '<img alt=":emotion:001:" src="/assets/owo/emotion/001.png" class="tk-owo-emotion">';

    const out = sanitizeHtml(`${image}<pre class="hljs"><code class="language-js">x</code></pre>`);

    expect(out).toContain(image);
    expect(out).toContain('class="hljs"');
    expect(out).toContain('class="language-js"');
  });

  it('drops <iframe> entirely', () => {
    const out = sanitizeHtml('<iframe src="https://evil"></iframe>after');

    expect(out).not.toContain('<iframe');
    expect(out).toContain('after');
  });

  it('passes plain text through unchanged', () => {
    expect(sanitizeHtml('just plain text')).toBe('just plain text');
  });
});
