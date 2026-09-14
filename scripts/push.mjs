import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { nextVersion } from './version.mjs';

function git(...args) {
  const config = process.platform === 'win32' ? ['-c', 'http.sslBackend=schannel'] : [];
  const result = spawnSync('git', [...config, ...args], { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed.`);
  return result.stdout.trim();
}
try {
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--bootstrap');
  if (unknown.length) throw new Error('Only --bootstrap is supported.');
  if (git('status', '--porcelain')) throw new Error('Commit all changes before pushing a version.');
  const branch = git('branch', '--show-current');
  if (!branch || ['main', 'master'].includes(branch))
    throw new Error('Push a feature branch for review.');
  const version = readFileSync('VERSION', 'utf8').trim(),
    pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (pkg.version !== version || !readFileSync('CHANGELOG.md', 'utf8').includes(`## [${version}]`))
    throw new Error('Version and changelog disagree.');
  const remote = git('ls-remote', '--tags', '--refs', 'origin');
  const versions = remote
    .split('\n')
    .map((line) => line.match(/refs\/tags\/v(\d+\.\d+\.\d+)$/)?.[1])
    .filter(Boolean)
    .sort((a, b) => {
      const aa = a.split('.').map(Number),
        bb = b.split('.').map(Number);
      return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
    });
  if (versions.includes(version))
    throw new Error(`v${version} has already been pushed. Prepare the next version first.`);
  const latest = versions.at(-1);
  if (latest && !['patch', 'minor', 'major'].some((kind) => nextVersion(latest, kind) === version))
    throw new Error(
      `Advance from v${latest} by exactly one patch, feature, or deployment version.`,
    );
  if (!latest && version !== '0.0.0') throw new Error('The first push must be v0.0.0.');
  const refs = [branch, `refs/tags/v${version}`];
  if (process.argv.includes('--bootstrap')) {
    if (git('ls-remote', '--heads', 'origin'))
      throw new Error('--bootstrap is only for an empty remote.');
    git('merge-base', '--is-ancestor', 'main', 'HEAD');
    refs.unshift('main');
  }
  const localTags = git('tag', '--list', `v${version}`);
  if (localTags) {
    if (git('rev-parse', `v${version}^{commit}`) !== git('rev-parse', 'HEAD'))
      throw new Error('The existing local version tag points to another commit.');
  } else git('tag', '-a', `v${version}`, '-m', `Panoptes v${version}`);
  console.log(git('push', '--atomic', '--set-upstream', 'origin', ...refs));
  console.log(`Pushed ${branch} and v${version}. Create the pull request when ready.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
