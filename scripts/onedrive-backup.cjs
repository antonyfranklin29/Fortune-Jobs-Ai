// Copy only a verified encrypted Fortune Jobs AI archive into OneDrive.
// This confirms local copy integrity, not that OneDrive has finished uploading.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { keyFrom, verify } = require('./private-backup.cjs');

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

async function publishEncryptedArchive(archive, oneDriveFolder, key) {
  const source = await fs.realpath(archive);
  const oneDrive = await fs.realpath(oneDriveFolder);
  if (isWithin(oneDrive, source)) throw new Error('Source archive must be outside OneDrive.');
  const name = path.basename(source);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name) || name === '.' || name === '..') {
    throw new Error('Use a simple archive folder name.');
  }

  // Decrypt and authenticate the entire archive before any cloud copy begins.
  const manifest = await verify(source, key);
  const destinationParent = path.join(oneDrive, 'Fortune Jobs AI Backups');
  await fs.mkdir(destinationParent, { recursive: true });
  const destination = path.join(destinationParent, name);
  try {
    await fs.lstat(destination);
    throw new Error('Destination already exists; backup archives are immutable.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const partial = path.join(destinationParent, `.partial-${crypto.randomUUID()}`);
  await fs.mkdir(partial);
  // Only opaque encrypted files are copied. The encrypted manifest is last.
  for (const file of manifest.files) {
    await fs.copyFile(path.join(source, file.id), path.join(partial, file.id), fs.constants.COPYFILE_EXCL);
  }
  await fs.copyFile(path.join(source, 'manifest.fjb'), path.join(partial, 'manifest.fjb'), fs.constants.COPYFILE_EXCL);
  const copied = await verify(partial, key);
  if (copied.files.length !== manifest.files.length) throw new Error('Copied archive count differs.');
  await fs.rename(partial, destination);
  return { destination, files: copied.files.length };
}

module.exports = { isWithin, publishEncryptedArchive };
if (require.main === module) (async () => {
  const [archive] = process.argv.slice(2);
  if (!archive || !process.env.OneDrive) throw new Error('Usage: node scripts/onedrive-backup.cjs ENCRYPTED_ARCHIVE (with OneDrive and FJ_BACKUP_KEY set)');
  const result = await publishEncryptedArchive(archive, process.env.OneDrive, keyFrom(process.env.FJ_BACKUP_KEY));
  console.log(JSON.stringify({ status: 'local_copy_verified', ...result,
    note: 'Confirm upload in OneDrive and re-download before calling this an off-site backup.' }));
})().catch(() => { console.error('OneDrive backup copy failed. No off-site backup should be assumed.'); process.exitCode = 1; });
