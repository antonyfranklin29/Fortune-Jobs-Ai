const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { backup, verify } = require('../scripts/private-backup.cjs');
const { publishEncryptedArchive } = require('../scripts/onedrive-backup.cjs');

test('copies only a verified encrypted archive and refuses overwrite', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fj-onedrive-test-'));
  try {
    const source = path.join(root, 'plain');
    const archive = path.join(root, 'archive-1');
    const cloud = path.join(root, 'fake-onedrive');
    const key = crypto.randomBytes(32);
    await fs.mkdir(source);
    await fs.mkdir(cloud);
    await fs.writeFile(path.join(source, 'resume.txt'), 'synthetic fixture only');
    await backup(source, archive, key);
    const result = await publishEncryptedArchive(archive, cloud, key);
    assert.equal(result.files, 1);
    assert.equal((await verify(result.destination, key)).files.length, 1);
    const copiedNames = await fs.readdir(result.destination);
    assert.equal(copiedNames.length, 2);
    assert.ok(copiedNames.includes('manifest.fjb'));
    assert.ok(!copiedNames.includes('resume.txt'));
    await assert.rejects(publishEncryptedArchive(archive, cloud, key), /already exists/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('refuses a corrupted archive before copying or creating an output folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fj-onedrive-test-'));
  try {
    const source = path.join(root, 'plain');
    const archive = path.join(root, 'archive-2');
    const cloud = path.join(root, 'fake-onedrive');
    const key = crypto.randomBytes(32);
    await fs.mkdir(source);
    await fs.mkdir(cloud);
    await fs.writeFile(path.join(source, 'fixture.txt'), 'synthetic fixture only');
    await backup(source, archive, key);
    await fs.writeFile(path.join(archive, 'manifest.fjb'), 'corrupted');
    await assert.rejects(publishEncryptedArchive(archive, cloud, key));
    await assert.rejects(fs.access(path.join(cloud, 'Fortune Jobs AI Backups')), /ENOENT/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('refuses an archive already inside the cloud folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fj-onedrive-test-'));
  try {
    const source = path.join(root, 'plain');
    const cloud = path.join(root, 'fake-onedrive');
    const archive = path.join(cloud, 'archive-3');
    const key = crypto.randomBytes(32);
    await fs.mkdir(source);
    await fs.mkdir(cloud);
    await fs.writeFile(path.join(source, 'fixture.txt'), 'synthetic fixture only');
    await backup(source, archive, key);
    await assert.rejects(publishEncryptedArchive(archive, cloud, key), /outside OneDrive/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
