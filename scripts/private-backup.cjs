// Operator-only tool. Never include this script or its keys in browser code.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_FILE = 64 * 1024 * 1024;
function keyFrom(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new Error('Set FJ_BACKUP_KEY to an independent 32-byte hex encryption key.');
  return Buffer.from(value, 'hex');
}
function seal(data, key) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('FortuneJobsAI backup v1'));
  return Buffer.concat([Buffer.from('FJB1'), iv, cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}
function open(data, key) {
  if (data.length < 32 || data.subarray(0, 4).toString() !== 'FJB1') throw new Error('Invalid backup format.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(4, 16));
  decipher.setAAD(Buffer.from('FortuneJobsAI backup v1'));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(16, -16)), decipher.final()]);
}
function safeRelative(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || name.includes('\0') || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe backup path.');
  return name;
}
async function backup(source, destination, key) {
  const root = await fs.realpath(source), target = path.resolve(destination);
  const relative = path.relative(root, target);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Backup destination must be outside source.');
  await fs.mkdir(target, { mode: 0o700 }); // refuses an existing destination
  const manifest = { version: 1, createdAt: new Date().toISOString(), files: [] };
  async function walk(folder, prefix = '') {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const name = safeRelative(prefix + entry.name), filename = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed.');
      if (entry.isDirectory()) await walk(filename, name + '/');
      else if (entry.isFile()) {
        const stat = await fs.lstat(filename);
        if (stat.size > MAX_FILE) throw new Error('File exceeds 64 MB limit; use a streaming database backup tool.');
        const data = await fs.readFile(filename), id = crypto.randomUUID() + '.fjb';
        await fs.writeFile(path.join(target, id), seal(data, key), { flag: 'wx', mode: 0o600 });
        manifest.files.push({ name, id, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
      } else throw new Error('Unsupported source entry.');
    }
  }
  await walk(root);
  await fs.writeFile(path.join(target, 'manifest.fjb'), seal(Buffer.from(JSON.stringify(manifest)), key), { flag: 'wx', mode: 0o600 });
  // Manifest is the completion marker; partial directories are never valid backups.
  return manifest.files.length;
}
async function verify(source, key) {
  const root = await fs.realpath(source);
  const manifest = JSON.parse(open(await fs.readFile(path.join(root, 'manifest.fjb')), key));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid manifest.');
  const names = new Set();
  for (const file of manifest.files) {
    safeRelative(file.name);
    if (names.has(file.name) || !/^[a-f0-9-]{36}\.fjb$/.test(file.id)) throw new Error('Invalid manifest entry.');
    names.add(file.name);
    const filename = path.join(root, file.id), stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE + 32) throw new Error('Invalid encrypted file.');
    const data = open(await fs.readFile(filename), key);
    if (data.length !== file.bytes || crypto.createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error('Backup integrity check failed.');
  }
  return manifest;
}
async function restore(source, destination, key) {
  const manifest = await verify(source, key); // authenticate every file before any output
  const target = path.resolve(destination);
  await fs.mkdir(target, { mode: 0o700 }); // refuses overwrite of existing directories
  for (const file of manifest.files) {
    const filename = path.join(target, ...file.name.split('/'));
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await fs.writeFile(filename, open(await fs.readFile(path.join(source, file.id)), key), { flag: 'wx', mode: 0o600 });
  }
  return manifest.files.length;
}
module.exports = { keyFrom, seal, open, safeRelative, backup, verify, restore };
if (require.main === module) (async () => {
  const [command, source, destination] = process.argv.slice(2), key = keyFrom(process.env.FJ_BACKUP_KEY);
  if (!source || !['backup', 'verify', 'restore'].includes(command) || (command !== 'verify' && !destination)) throw new Error('Usage: node scripts/private-backup.cjs backup|restore SOURCE NEW_DESTINATION; or verify SOURCE');
  const result = command === 'backup' ? await backup(source, destination, key) : command === 'restore' ? await restore(source, destination, key) : (await verify(source, key)).files.length;
  console.log(JSON.stringify({ status: 'ok', command, files: result }));
})().catch(() => { console.error('Backup operation failed. Check key, permissions, paths and integrity. No completed backup should be assumed.'); process.exitCode = 1; });
