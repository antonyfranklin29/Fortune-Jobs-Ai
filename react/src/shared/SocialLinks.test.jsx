import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SocialLinks } from './SocialLinks.jsx';

describe('SocialLinks', () => {
  it('links to our Instagram, Facebook and LinkedIn pages in a new tab', () => {
    render(<SocialLinks />);
    const links = screen.getAllByRole('link');
    expect(links.map(a => a.getAttribute('aria-label'))).toEqual(['Fortune Jobs AI on Instagram', 'Fortune Jobs AI on Facebook', 'Fortune Jobs AI on LinkedIn']);
    expect(links.every(a => a.target === '_blank' && a.rel.includes('noopener'))).toBe(true);
    expect(links[2].href).toBe('https://www.linkedin.com/company/fortunejobsai/');
  });
});
