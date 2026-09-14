import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextVersion, prepareVersion } from '../scripts/version.mjs';
import { temporary } from './helpers.mjs';

test('project version policy distinguishes fixes, features, and actual deployments', () => {
  assert.equal(nextVersion('0.0.0', 'patch'), '0.0.1');
  assert.equal(nextVersion('0.0.9', 'minor'), '0.1.0');
  assert.equal(nextVersion('0.12.3', 'major'), '1.0.0');
  assert.throws(() => nextVersion('0.0.0', 'release'));
  assert.throws(() => nextVersion('garbage', 'patch'));
});
test('version preparation updates all files and preserves prior history', (t) => {
  const dir = temporary(t);
  const files = {
    VERSION: '0.0.0\n',
    'package.json': JSON.stringify({ version: '0.0.0' }),
    'package-lock.json': JSON.stringify({
      version: '0.0.0',
      packages: { '': { version: '0.0.0' } },
    }),
    'CHANGELOG.md': '# Changelog\n\n## [0.0.0] - 2026-09-14\n\n- Initial version.\n',
  };
  for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content);
  assert.equal(prepareVersion(dir, 'minor', 'Add research feature.', '2026-09-15'), '0.1.0');
  const read = (file) => readFileSync(join(dir, file), 'utf8');
  assert.equal(read('VERSION').trim(), '0.1.0');
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].version, '0.1.0');
  assert.match(read('CHANGELOG.md'), /\[0.1.0\].*2026-09-15/);
  assert.match(read('CHANGELOG.md'), /Initial version/);
  const before = read('VERSION');
  assert.throws(() => prepareVersion(dir, 'patch', ''));
  assert.equal(read('VERSION'), before);
});
