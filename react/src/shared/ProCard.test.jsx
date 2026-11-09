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
  it('Pro is open: everyone sees Subscribe, not "Coming soon"', () => {
    render(<ProCard subscription={null} />);
    expect(screen.queryByText('Coming soon')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Subscribe to Pro' }).length).toBeGreaterThan(0);
  });
  it('shows the renewal and refund terms next to Subscribe', () => {
    render(<ProCard subscription={null} />);
    expect(screen.getAllByText(/Renews monthly at \$9\.99 until you cancel/).length).toBeGreaterThan(0);
  });
  it('tells members they have Pro and when it renews', () => {
    render(<><ProCard subscription={active} /><SubscriptionSection subscription={active} /></>);
    expect(screen.getByText('Active ✓')).toBeTruthy();
    expect(screen.getByText(/Renews on/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage or cancel' })).toBeTruthy();
  });
});
