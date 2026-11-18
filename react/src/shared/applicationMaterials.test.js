// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { keepMaterial, persistPendingMaterials, loadMaterialContext, watchMaterialAccount } from './applicationMaterials.js';

const job = { job_title: 'Analyst', company: 'Test', apply_url: 'https://example.com/job' };
const material = { result: { summary: 'SQL' }, identity: { name: 'Test Student' }, generated_at: '2026-11-18T12:00:00Z' };
function client(userId, saved = {}) {
  const user = userId ? { id: userId, email: 'student@example.com' } : null;
  return {
    auth: { getSession: async () => ({ data: { session: user && { user } } }) },
    from: table => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'profiles' ? { full_name: 'Test Student' } : { materials: saved } }) };
      return query;
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
}
it('keeps drafts for an unsaved job and flushes both when the job is saved later', async () => {
  const sb = client('student-1');
  expect(await keepMaterial(job, 'tailor_resume', material, 'student-1', sb)).toMatch(/Save this job/);
  await keepMaterial(job, 'cover_letter', material, 'student-1', sb);
  sb.rpc.mockClear(); sb.rpc.mockResolvedValue({ data: { tailor_resume: material, cover_letter: material } });
  await persistPendingMaterials(job, sb);
  expect(sb.rpc.mock.calls.map(([, args]) => args.p_kind)).toEqual(['tailor_resume', 'cover_letter']);
  const context = await loadMaterialContext(job, sb);
  expect(context.identity.name).toBe('Test Student');
  expect(context.materials.tailor_resume.result.summary).toBe('SQL');
});
it('does not expose one account’s pending draft or save it as another account', async () => {
  const other = client('student-2');
  expect((await loadMaterialContext(job, other)).materials).toEqual({});
  await expect(keepMaterial(job, 'tailor_resume', material, 'student-1', other)).rejects.toThrow(/account changed/);
  expect(other.rpc).not.toHaveBeenCalled();
});
it('clears in-memory drafts when the authenticated account changes', async () => {
  const sb = client('student-3'); let authChange;
  sb.auth.onAuthStateChange = callback => { authChange = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; };
  const changed = vi.fn();
  const stop = await watchMaterialAccount(changed, sb);
  authChange('INITIAL_SESSION', { user: { id: 'student-3' } });
  await keepMaterial(job, 'tailor_resume', material, 'student-3', sb);
  authChange('SIGNED_OUT', null);
  expect(changed).toHaveBeenCalledOnce();
  expect((await loadMaterialContext(job, sb)).materials).toEqual({});
  stop();
});
