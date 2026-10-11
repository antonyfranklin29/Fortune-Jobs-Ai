const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const tool = require('../scripts/private-backup.cjs');
test('encrypted backups restore synthetic nested files and hide file names', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fj-backup-test-'));
  try {
    const source = path.join(root, 'source'), archive = path.join(root, 'archive'), restored = path.join(root, 'restore'), key = crypto.randomBytes(32);
    await fs.mkdir(path.join(source, 'resumes'), { recursive: true });
    await fs.writeFile(path.join(source, 'resumes', 'synthetic.pdf'), 'synthetic private content');
    assert.equal(await tool.backup(source, archive, key), 1);
    assert.equal((await tool.verify(archive, key)).files.length, 1);
    assert.equal(await tool.restore(archive, restored, key), 1);
    assert.equal(await fs.readFile(path.join(restored, 'resumes', 'synthetic.pdf'), 'utf8'), 'synthetic private content');
    assert.ok(!(await fs.readdir(archive)).some(n => n.includes('synthetic')));
    await assert.rejects(tool.restore(archive, restored, key));
    await assert.rejects(tool.verify(archive, crypto.randomBytes(32)));
    const names = await fs.readdir(archive), blob = names.find(n => n !== 'manifest.fjb');
    const data = await fs.readFile(path.join(archive, blob)); data[17] ^= 1;
    await fs.writeFile(path.join(archive, blob), data);
    await assert.rejects(tool.restore(archive, path.join(root, 'tampered-restore'), key));
    await assert.rejects(fs.stat(path.join(root, 'tampered-restore')));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('rejects traversal, invalid keys and unsafe paths', () => {
  for (const name of ['../secret', '/absolute', 'a/../../b', 'C:/private', 'a\\b', 'a//b']) assert.throws(() => tool.safeRelative(name));
  assert.throws(() => tool.keyFrom('weak'));
  assert.equal(tool.keyFrom('ab'.repeat(32)).length, 32);
});
