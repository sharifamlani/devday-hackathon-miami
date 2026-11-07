import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local export only: no network, credentials, Git writes, or deployment.
const expectedProject = 'appgprj_6aef8e7b3e948191989ddbadf3924bb5';
const prefix = 'sites/kindred/';
const args = process.argv.slice(2);
let sourceCommit, output;
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === '--source-commit') sourceCommit = args[i + 1];
  else if (args[i] === '--output') output = args[i + 1];
  else throw new Error('Use --source-commit <full 40-character SHA> --output <new absolute directory>.');
}
if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? '') || !output || !isAbsolute(output)) {
  throw new Error('A full 40-character commit SHA and an absolute output directory are required.');
}
const scriptDir = dirname(fileURLToPath(import.meta.url));
const git = (...argv) => execFileSync('git', ['-C', scriptDir, ...argv], { maxBuffer: 20 * 1024 * 1024 });
const root = git('rev-parse', '--show-toplevel').toString().trim();
const destination = resolve(output);
const rel = relative(root, destination);
if (!rel || (!(rel === '..' || rel.startsWith('..' + sep)) && !isAbsolute(rel))) throw new Error('Export outside the repository.');
if (existsSync(destination)) throw new Error('Output already exists; choose a new directory.');
const resolved = git('rev-parse', '--verify', `${sourceCommit}^{commit}`).toString().trim();
if (resolved !== sourceCommit) throw new Error('Commit resolution mismatch.');
const entries = git('ls-tree', '-rz', '--full-tree', sourceCommit, '--', prefix).toString().split('\0').filter(Boolean);
const files = entries.map(entry => {
  const split = entry.indexOf('\t');
  const [mode, type] = entry.slice(0, split).split(' ');
  const path = entry.slice(split + 1);
  const name = path.slice(prefix.length);
  if (!path.startsWith(prefix) || type !== 'blob' || !['100644', '100755'].includes(mode)) {
    throw new Error(`Unsupported source entry: ${path}`);
  }
  if (!name || name === 'RELEASE.json' || name.split('/').some(p => p === '..' || p === '.git') || /(^|\/)\.env(?:\.|$)/.test(name)) {
    throw new Error(`Unsafe source entry: ${path}`);
  }
  return { name, bytes: git('show', `${sourceCommit}:${path}`) };
});
const manifestFile = files.find(f => f.name === '.openai/hosting.json');
const index = files.find(f => f.name === 'dist/index.html');
if (!manifestFile || !index) throw new Error('Release needs .openai/hosting.json and dist/index.html.');
const manifest = JSON.parse(manifestFile.bytes.toString());
if (manifest.project_id !== expectedProject || manifest.static?.directory !== 'dist') {
  throw new Error('Wrong Site identity or static output directory. Do not create a new Site.');
}
const hashes = Object.fromEntries(files.map(f => [f.name, createHash('sha256').update(f.bytes).digest('hex')]));
mkdirSync(destination, { recursive: true });
for (const file of files) {
  const target = join(destination, file.name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.bytes, { flag: 'wx' });
}
writeFileSync(join(destination, 'RELEASE.json'), JSON.stringify({
  repository: 'sharifamlani/devday-hackathon-miami', source_commit: sourceCommit,
  source_path: prefix.slice(0, -1), project_id: expectedProject, sha256: hashes
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ source_commit: sourceCommit, release_directory: destination,
  project_id: expectedProject, file_count: files.length, deployed: false }, null, 2));
