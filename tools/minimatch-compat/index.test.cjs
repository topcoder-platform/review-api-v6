const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const legacyRequire = createRequire(require.resolve('eslint'));
const match = legacyRequire('minimatch');

test('submission archives discover files through the patched glob dependency', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-compat-'));
  try {
    fs.writeFileSync(path.join(directory, 'submission.txt'), 'submission');
    fs.writeFileSync(path.join(directory, 'ignored.png'), 'ignored');
    const archive = require('archiver')('zip');
    const entries = [];
    const chunks = [];
    archive.on('entry', entry => entries.push(entry.name));
    archive.on('data', chunk => chunks.push(chunk));
    const ended = new Promise((resolve, reject) => {
      archive.once('end', resolve);
      archive.once('error', reject);
    });
    archive.glob('*.txt', { cwd: directory });
    await archive.finalize();
    await ended;
    assert.deepEqual(entries, ['submission.txt']);
    assert.equal(Buffer.concat(chunks).subarray(0, 2).toString(), 'PK');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy consumers retain the callable minimatch API', () => {
  assert.equal(typeof match, 'function');
  assert.equal(match('src/main.ts', '**/*.ts'), true);
  assert.equal(match('src/main.js', '**/*.ts'), false);
  assert.equal(match('.env', '*'), false);
  assert.equal(match.defaults({ dot: true })('.env', '*'), true);
  assert.deepEqual(match.match(['a.ts', 'b.js'], '*.ts'), ['a.ts']);
  assert.deepEqual(['a.ts', 'b.js'].filter(match.filter('*.ts')), ['a.ts']);
  assert.deepEqual(match.braceExpand('*.{js,ts}'), ['*.js', '*.ts']);
  assert.equal(new match.Minimatch('**/*.ts').match('src/main.ts'), true);
  assert.equal(match.Minimatch.defaults({ dot: true }) !== undefined, true);
  assert.equal(typeof match.GLOBSTAR, 'symbol');
});

test('installed glob discovers source files with patched matching', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const entries = fs.readdirSync('node_modules/.pnpm');
  const entry = entries.find(p => p.startsWith('glob@7.')) || entries.find(p => p.startsWith('glob@14.'));
  assert.ok(entry, 'Expected an installed glob consumer');
  const glob = require(path.resolve('node_modules/.pnpm', entry, 'node_modules/glob'));
  assert.ok(glob.sync('src/**/*.ts').includes('src/main.ts'));
});

test('amplifying glob patterns terminate within a bounded time', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const match = require(${JSON.stringify(legacyRequire.resolve('minimatch'))});
    new match.Minimatch('**/../'.repeat(30) + '*.ts', { optimizationLevel: 2 });
  `], { timeout: 5000, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
