import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AccountServicesProvider, createAccountServices } from '../services.jsx';
import { Avatar } from '../components.jsx';

const BASE = 'https://proj.supabase.test';
const user = { id: '11111111-2222-4333-8444-555555555555', email: 'qa@example.test' };
function setup(avatar_url, signed = { data: { signedUrl: `${BASE}/storage/v1/object/sign/avatars/x?token=t` } }) {
  const createSignedUrl = vi.fn().mockResolvedValue(signed);
  const sb = { storage: { from: vi.fn(() => ({ createSignedUrl })) }, auth: {} };
  const services = createAccountServices({ sb, config: { url: BASE, key: 'k' }, location: {}, navigate() {}, replace() {} });
  const { container } = render(<AccountServicesProvider services={services}><Avatar profile={{ full_name: 'Q A', avatar_url }} user={user} /></AccountServicesProvider>);
  return { container, createSignedUrl };
}

describe('Avatar (private bucket)', () => {
  afterEach(cleanup);
  it('shows the photo through a signed link, never the stored public-style URL', async () => {
    const { container, createSignedUrl } = setup(`${BASE}/storage/v1/object/public/avatars/${user.id}/avatar-1.png`);
    await vi.waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    expect(createSignedUrl).toHaveBeenCalledWith(`${user.id}/avatar-1.png`, 3600);
    expect(container.querySelector('img').getAttribute('src')).toContain('/object/sign/');
  });
  it('shows initials for a photo outside the user\'s own folder', () => {
    const { createSignedUrl } = setup(`${BASE}/storage/v1/object/public/avatars/someone-else/a.png`);
    expect(screen.getByText('QA')).toBeTruthy();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
