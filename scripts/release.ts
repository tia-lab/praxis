import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bumpVersion, isSemver, mergeChangelog, renderSection } from './release-lib.ts';
import type { Increment, ReleaseCommit } from './release-lib.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const push = args.includes('--push');
const initial = args.includes('--initial');
const values = args.filter(arg => !arg.startsWith('--'));
const requested = values[0];
if (values.length !== 1 || !requested) {
  console.error('Usage: bun run release <patch|minor|major|VERSION> [--initial] [--push]');
  process.exit(2);
}
if (initial && !isSemver(requested)) {
  console.error('release: --initial requires an explicit version such as 0.0.1');
  process.exit(2);
}

const run = (command: string, commandArgs: string[]): void => {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(command + ' ' + commandArgs.join(' ') + ' failed with ' + result.status);
};
const capture = (command: string, commandArgs: string[]): string =>
  execFileSync(command, commandArgs, { cwd: root, encoding: 'utf8' }).trim();

const fail = (message: string): never => { console.error('release: ' + message); process.exit(1); };
const status = capture('git', ['status', '--porcelain']);
if (status) fail('working tree is not clean; commit or stash changes first.');
const branch = capture('git', ['branch', '--show-current']);
if (!branch) fail('detached HEAD; check out a branch first.');
const packagePath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string; name?: string };
if (!pkg.version) fail('package.json has no version.');
let version = String(pkg.version);
if (initial) {
  if (capture('git', ['tag', '--list', 'v*'])) fail('--initial requires a repository with no existing release tags.');
  version = requested;
} else if (['patch', 'minor', 'major'].includes(requested)) {
  version = bumpVersion(String(pkg.version), requested as Increment);
} else {
  fail('explicit versions require --initial; otherwise use patch, minor or major.');
}
const tag = 'v' + version;
if (capture('git', ['tag', '--list', tag])) fail('tag ' + tag + ' already exists.');
console.log('release: ' + pkg.name + ' ' + pkg.version + ' -> ' + version);

run('npm', ['run', 'check']);
run('npm', ['test']);

const packageText = readFileSync(packagePath, 'utf8');
writeFileSync(packagePath, packageText.replace(/("version"\s*:\s*")[^"]+(")/, '$1' + version + '$2'));
const lockPath = join(root, 'package-lock.json');
const changed: string[] = [relative(root, packagePath)];
if (existsSync(lockPath)) {
  type Lockfile = { version?: string; packages?: Record<string, { version?: string }> };
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Lockfile;
  lock.version = version;
  if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  changed.push(relative(root, lockPath));
}

const lastTag = (() => {
  try { return capture('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*']); }
  catch { return ''; }
})();
const range = lastTag ? lastTag + '..HEAD' : 'HEAD';
const commits: ReleaseCommit[] = capture('git', ['log', '--pretty=format:%h%x09%s', range])
  .split('\n').filter(Boolean).map(line => {
    const [hash, ...subject] = line.split('\t');
    return { hash: String(hash), subject: subject.join('\t') };
  });
const changelogPath = join(root, 'CHANGELOG.md');
const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
const date = new Date().toISOString().slice(0, 10);
writeFileSync(changelogPath, mergeChangelog(existing, renderSection(version, date, commits)));
changed.push(relative(root, changelogPath));

run('git', ['add', ...changed]);
run('git', ['commit', '-m', 'chore(release): ' + tag]);
run('git', ['tag', '-a', tag, '-m', tag]);
if (push) {
  run('git', ['push', 'origin', branch]);
  run('git', ['push', 'origin', tag]);
}
console.log('release: committed ' + tag + (push ? ' and pushed branch + tag' : ' locally; push with --push'));
