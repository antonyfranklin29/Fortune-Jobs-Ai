import { describe, it, expect } from 'vitest';
import { outcome } from '../lib/accountDeletion.js';

describe('account deletion with Pro', () => {
  it('says nothing was deleted when Pro could not be cancelled', () => {
    const o = outcome(409, { status: 'incomplete', reason: 'subscription_not_cancelled' });
    expect(o.kind).toBe('subscription');
    expect(o.message).toMatch(/nothing was deleted/);
    expect(o.message).not.toMatch(/permanently deleted/);
  });
});
