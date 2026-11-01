export type Increment = 'patch' | 'minor' | 'major';

export function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value);
}

export function bumpVersion(version: string, increment: Increment): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) throw new Error('Expected a semver version, got ' + version);
  let major = Number(match[1]), minor = Number(match[2]), patch = Number(match[3]);
  if (increment === 'major') { major += 1; minor = 0; patch = 0; }
  else if (increment === 'minor') { minor += 1; patch = 0; }
  else patch += 1;
  return major + '.' + minor + '.' + patch;
}

export type ReleaseCommit = { hash: string; subject: string };

function category(subject: string): { title: string; body: string } {
  const match = /^(?:\[[^\]]+\]\s*)?([A-Za-z]+)(?:\(([^)]+)\))?:\s*(.+)$/.exec(subject);
  if (!match) return { title: 'Other', body: '- ' + subject };
  const type = match[1]!.toLowerCase(), scope = match[2], text = match[3]!;
  const title = type === 'feat' ? 'Features' : type === 'fix' ? 'Fixes' : 'Other';
  return { title, body: '- ' + (scope ? scope + ': ' : '') + text };
}

export function renderSection(version: string, date: string, commits: ReleaseCommit[]): string {
  const groups = new Map<string, string[]>();
  for (const commit of commits) {
    const entry = category(commit.subject);
    if (!groups.has(entry.title)) groups.set(entry.title, []);
    groups.get(entry.title)!.push(entry.body);
  }
  const order = ['Features', 'Fixes', 'Other'];
  const body = order.filter(title => groups.has(title))
    .map(title => '### ' + title + '\n\n' + groups.get(title)!.join('\n')).join('\n\n');
  return '## [' + version + '] - ' + date + '\n\n' + (body || '### Other\n\n- No recorded changes.') + '\n';
}

export function mergeChangelog(existing: string, section: string): string {
  const header = '# Changelog\n\nAll notable changes to this project are documented here.\n';
  if (!existing.trim()) return header + '\n' + section;
  const start = existing.indexOf('\n## [');
  if (start < 0) return existing.replace(/\s*$/, '') + '\n\n' + section;
  return existing.slice(0, start + 1) + section + existing.slice(start + 1);
}
