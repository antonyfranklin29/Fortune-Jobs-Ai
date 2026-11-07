import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProCard, SubscriptionSection } from './ProCard.jsx';
import { isActive } from './billing.js';

const active = { status: 'active', current_period_end: new Date(Date.now() + 86400000 * 20).toISOString(), cancel_at_period_end: false };

describe('Pro', () => {
  beforeEach(() => sessionStorage.clear());
  it('is active only while Stripe says so and the period has not ended', () => {
    expect(isActive(active)).toBe(true);
    expect(isActive({ ...active, status: 'past_due' })).toBe(false);
    expect(isActive({ ...active, current_period_end: new Date(Date.now() - 1000).toISOString() })).toBe(false);
    expect(isActive(null)).toBe(false);
  });
  it('shows "Coming soon" with no Subscribe button until Pro opens', () => {
    render(<ProCard subscription={null} />);
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull();
  });
  it('shows Subscribe and the renewal terms to testers', () => {
    sessionStorage.setItem('fj_pro_test', '1');
    render(<ProCard subscription={null} />);
    expect(screen.getByRole('button', { name: 'Subscribe to Pro' })).toBeTruthy();
    expect(screen.getByText(/Renews monthly at \$9\.99 until you cancel/)).toBeTruthy();
  });
  it('tells members they have Pro and when it renews', () => {
    render(<><ProCard subscription={active} /><SubscriptionSection subscription={active} /></>);
    expect(screen.getByText('Active ✓')).toBeTruthy();
    expect(screen.getByText(/Renews on/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage or cancel' })).toBeTruthy();
  });
});
