import { describe, expect, it } from 'vitest';
import { fixApplyUrl } from './applyUrl.js';
describe('fixApplyUrl', () => {
  it('sends bare Adzuna redirect links to the Adzuna job page', () => {
    expect(fixApplyUrl('https://www.adzuna.com/land/ad/5955852867')).toBe('https://www.adzuna.com/details/5955852867');
    expect(fixApplyUrl('https://adzuna.com/land/ad/123/')).toBe('https://www.adzuna.com/details/123');
  });
  it('leaves signed Adzuna links and other sites alone', () => {
    const signed = 'https://www.adzuna.com/land/ad/5955852867?se=abc&utm_medium=api&v=DEF';
    expect(fixApplyUrl(signed)).toBe(signed);
    expect(fixApplyUrl('https://www.adzuna.com/details/1')).toBe('https://www.adzuna.com/details/1');
    expect(fixApplyUrl('https://boards.greenhouse.io/x/jobs/1')).toBe('https://boards.greenhouse.io/x/jobs/1');
    expect(fixApplyUrl(null)).toBe(null);
  });
});
