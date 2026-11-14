import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SignupNudge } from './SignupNudge.jsx';

describe('SignupNudge', () => {
  beforeEach(() => window.localStorage.clear());
  it('links to sign-up and stays hidden once dismissed', () => {
    const { unmount } = render(<SignupNudge href="./login.html?mode=signup" />);
    expect(screen.getByRole('link', { name: 'Create free account' }).getAttribute('href')).toBe('./login.html?mode=signup');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('link', { name: 'Create free account' })).toBeNull();
    unmount();
    render(<SignupNudge href="x" />);
    expect(screen.queryByRole('link', { name: 'Create free account' })).toBeNull();
  });
});
