// The React informational pages must say exactly what the static pages said:
// same words, same links, same headings. Wording changes need a policy review.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AboutPage, PrivacyPage, TermsPage, ContactPage } from '../index.js';

afterEach(cleanup);
const here = dirname(fileURLToPath(import.meta.url));
// The pre-React static pages, kept as the reference copy.
const legacy = (name) => readFileSync(resolve(here, 'legacy', name), 'utf8');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function legacyBody(name) {
  const doc = new DOMParser().parseFromString(legacy(name), 'text/html');
  doc.querySelectorAll('script,style').forEach((n) => n.remove());
  return doc.body;
}
const links = (root) => [...root.querySelectorAll('a')].map((a) => [norm(a.textContent), a.getAttribute('href')]);
const headings = (root) => [...root.querySelectorAll('h1,h2,h3')].map((h) => norm(h.textContent));

describe.each([
  ['about.html', AboutPage], ['privacy.html', PrivacyPage], ['terms.html', TermsPage], ['contact.html', ContactPage],
])('%s', (file, Page) => {
  it('has the same text, headings and links as the static page', () => {
    const { container } = render(<Page />);
    const old = legacyBody(file);
    // Whitespace between block elements is not significant; text inside each block is.
    const blocks = (root) => [...root.querySelectorAll('h1,h2,h3,p,li,a,span,strong')].map((n) => norm(n.textContent));
    expect(blocks(container)).toEqual(blocks(old));
    expect(norm(container.textContent).replace(/\s/g, '')).toBe(norm(old.textContent).replace(/\s/g, ''));
    expect(headings(container)).toEqual(headings(old));
    expect(links(container)).toEqual(links(old));
  });
});
