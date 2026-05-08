import { describe, expect, it } from 'vitest';

import { sanitizeHtml } from '@/lib/sanitize';

describe('sanitizeHtml', () => {
  it('strips <script> tags and their bodies entirely', () => {
    const out = sanitizeHtml('hi<script>alert(1)</script>there');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('hi');
    expect(out).toContain('there');
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

  it('keeps img with src/alt and code with class', () => {
    const out = sanitizeHtml(
      '<img src="https://example.com/a.png" alt="pic"><pre class="hljs"><code class="language-js">x</code></pre>',
    );
    expect(out).toContain('<img');
    expect(out).toContain('src="https://example.com/a.png"');
    expect(out).toContain('alt="pic"');
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
