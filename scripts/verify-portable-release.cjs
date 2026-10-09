const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const stage = path.join(root, 'release', 'DevVault-Windows-x64');
const archive = path.join(root, 'release', 'DevVault-Windows-x64.zip');
const launcher = path.join(stage, 'Запустить DevVault.bat');
const instruction = path.join(stage, 'ИНСТРУКЦИЯ.md');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function walkFiles(dir, prefix = '') {
  const found = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name);
    if (item.isDirectory()) found.push(...walkFiles(path.join(dir, item.name), relative));
    else found.push(relative);
  }
  return found;
}

function verifyModules() {
  const argonPath = require.resolve('argon2', { paths: [stage] });
  const sqlitePath = require.resolve('better-sqlite3', { paths: [stage] });
  const argon = require(path.join(stage, 'node_modules', 'argon2'));
  assert.equal(typeof argon.hash, 'function');
  const Database = require(path.join(stage, 'node_modules', 'better-sqlite3'));
  const db = new Database(':memory:');
  const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version;
  db.close();
  console.log(`argon2 загружен: ${argonPath}`);
  console.log(`better-sqlite3 загружен (SQLite ${sqliteVersion}): ${sqlitePath}`);
}

function verifyFirstRun() {
  const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'devvault-portable-localappdata-'));
  try {
    const env = { ...process.env, DEVVAULT_PORTABLE: '1', LOCALAPPDATA: localAppData };
    delete env.DEVVAULT_DATA_DIR;
    const stdout = run(path.join(stage, 'node.exe'), [path.join(stage, 'dist', 'index.js')], {
      input: 'y\nPortableSmokePass123!\nPortableSmokePass123!\n5\n',
      env,
    });
    assert.match(stdout, /Хранилище создано\./);
    assert.match(stdout, /До свидания\./);
    const dbPath = path.join(localAppData, 'DevVault', 'devvault.db');
    assert.ok(fs.existsSync(dbPath), `Expected database at ${dbPath}`);
    assert.equal(fs.existsSync(path.join(stage, 'data')), false);
    const Database = require(path.join(stage, 'node_modules', 'better-sqlite3'));
    const db = new Database(dbPath, { readonly: true });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 1);
    db.close();
    const dbBytes = fs.readFileSync(dbPath);
    assert.equal(dbBytes.includes(Buffer.from('PortableSmokePass123!')), false);
    console.log(`Первый запуск успешен; SQLite создана в ${dbPath}`);
  } finally {
    fs.rmSync(localAppData, { recursive: true, force: true });
  }
}

function verifyArchiveContents() {
  const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::OpenRead('${archive.replace(/'/g, "''")}'); try { foreach ($e in $z.Entries) { $e.FullName }; } finally { $z.Dispose() }`;
  const names = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((name) => name.replace(/\\/g, '/'));
  assert.ok(names.some((name) => name.endsWith('node.exe')));
  assert.ok(names.some((name) => name.endsWith('node_modules/argon2/argon2.cjs')));
  assert.ok(names.some((name) => name.endsWith('node_modules/better-sqlite3/lib/index.js')));
  const forbidden = names.filter((name) => /(^|[\\/])(?:\.git|tests?|data)(?:[\\/]|$)|\.env(?:\.|$)|\.db(?:$|-)/i.test(name));
  assert.deepEqual(forbidden, [], `Forbidden archive paths: ${forbidden.join(', ')}`);
  const files = walkFiles(stage);
  for (const name of files) {
    assert.doesNotMatch(name, /(^|[\\/])(?:\.git|tests?|data)(?:[\\/]|$)|\.env(?:\.|$)|\.db(?:$|-)/i);
  }
  for (const relative of files.filter((name) => /\.(?:js|json|md|bat|txt)$/i.test(name))) {
    const contents = fs.readFileSync(path.join(stage, ...relative.split('/')), 'utf8');
    assert.doesNotMatch(contents, /PortableSmokePass123!|S3cret!Pass|Sup3rPass|Password123!|testdata/);
  }
  console.log(`ZIP содержит ${names.length} записей; запрещённых файлов и проверочных секретов нет.`);
}

try {
  assert.ok(fs.existsSync(archive), `Missing archive ${archive}`);
  assert.ok(fs.existsSync(launcher), `Missing launcher ${launcher}`);
  assert.ok(fs.existsSync(instruction), `Missing instructions ${instruction}`);
  verifyModules();
  verifyFirstRun();
  verifyArchiveContents();
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
