import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PartnerApply } from './PartnerApply.jsx';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('only opens the original WhatJobs URL after a user clicks', () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  const original = 'https://us.whatjobs.com/job?t=a%2fb+X&v=One%20Two';
  render(<PartnerApply job={{ source: 'whatjobs', apply_url: original }}>Apply</PartnerApply>);
  expect(open).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: 'Apply' });
  expect(button.hasAttribute('href')).toBe(false);
  fireEvent.click(button);
  expect(open).toHaveBeenCalledWith(original, '_blank', 'noopener,noreferrer');
});
