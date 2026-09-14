import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')),
  lock = JSON.parse(readFileSync('package-lock.json', 'utf8')),
  version = readFileSync('VERSION', 'utf8').trim();
if (
  !/^\d+\.\d+\.\d+$/.test(version) ||
  pkg.version !== version ||
  lock.version !== version ||
  lock.packages[''].version !== version
)
  throw new Error('VERSION, package.json, and package-lock.json must agree.');
const latest = readFileSync('CHANGELOG.md', 'utf8').match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];
if (latest !== version) throw new Error('The newest changelog entry must match VERSION.');
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}
const modules = ['src', 'scripts', 'test', 'public']
  .flatMap(files)
  .filter((file) => /\.(mjs|js)$/.test(file));
for (const file of modules) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(
  `Version v${version} is consistent; ${modules.length} JavaScript files passed syntax checks.`,
);
