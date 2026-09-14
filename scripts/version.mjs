import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function nextVersion(current, kind) {
  if (!/^\d+\.\d+\.\d+$/.test(current)) throw new Error('Invalid current version.');
  const [major, minor, patch] = current.split('.').map(Number);
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'major') return `${major + 1}.0.0`;
  throw new Error('Use patch (fix), minor (feature), or major (deployment).');
}
export function prepareVersion(
  directory,
  kind,
  message,
  date = new Date().toISOString().slice(0, 10),
) {
  if (typeof message !== 'string' || !message.trim() || /[\r\n]/.test(message))
    throw new Error('Provide a one-line change description.');
  const read = (name) => readFileSync(join(directory, name), 'utf8');
  const current = read('VERSION').trim(),
    pkg = JSON.parse(read('package.json')),
    lock = JSON.parse(read('package-lock.json')),
    log = read('CHANGELOG.md');
  if (pkg.version !== current || lock.version !== current || lock.packages[''].version !== current)
    throw new Error('Version files disagree.');
  if (!log.includes(`## [${current}]`)) throw new Error('Current changelog entry is missing.');
  const version = nextVersion(current, kind);
  pkg.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  const heading = log.indexOf('\n## [');
  if (heading < 0) throw new Error('Invalid changelog structure.');
  const category = { patch: 'Fixed', minor: 'Added', major: 'Deployed' }[kind];
  const updated =
    log.slice(0, heading) +
    `\n## [${version}] - ${date}\n\n### ${category}\n\n- ${message.trim()}\n` +
    log.slice(heading);
  const writes = [
    ['VERSION', version + '\n'],
    ['package.json', JSON.stringify(pkg, null, 2) + '\n'],
    ['package-lock.json', JSON.stringify(lock, null, 2) + '\n'],
    ['CHANGELOG.md', updated],
  ];
  for (const [name, content] of writes) writeFileSync(join(directory, name), content);
  return version;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const version = prepareVersion(process.cwd(), process.argv[2], process.argv.slice(3).join(' '));
    console.log(
      `Prepared v${version}. Review CHANGELOG.md, run checks, commit, then release:push.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
