import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const projectRoot = resolve(__dirname, '..');
const tsxCli = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

interface CliRun {
  code: number | null;
  stdout: string;
}

function runCli(dataDir: string, script: string): Promise<CliRun> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [tsxCli, join(projectRoot, 'src', 'index.ts')], {
      cwd: projectRoot,
      env: { ...process.env, DEVVAULT_DATA_DIR: dataDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error('CLI run timed out'));
    }, 120_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout });
    });
    child.stdin.end(script);
  });
}

function newDir(): string {
  return mkdtempSync(join(tmpdir(), 'devvault-cli-'));
}

describe('CLI integration (piped input)', () => {
  // Shared with the database-scan test below.
  const crudDir = newDir();
  const dirs = [crudDir];

  afterAll(() => {
    dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  it('offers to create a vault and exits cleanly on N', async () => {
    const dir = newDir();
    dirs.push(dir);
    const { code, stdout } = await runCli(dir, 'n\n');
    expect(code).toBe(0);
    expect(stdout).toContain('DEVVAULT');
    expect(stdout).toContain('Vault not found.');
    expect(stdout).toContain('Create a new Vault?');
    expect(stdout).toContain('Goodbye');
  }, 120_000);

  it('rejects a short master password', async () => {
    const dir = newDir();
    dirs.push(dir);
    const { stdout } = await runCli(dir, 'y\nshort\nshort\n');
    expect(stdout).toContain('at least 8');
  }, 120_000);

  it('rejects mismatched password confirmation', async () => {
    const dir = newDir();
    dirs.push(dir);
    const { stdout } = await runCli(dir, 'y\nPassword123!\nDifferent123!\n');
    expect(stdout).toContain('do not match');
  }, 120_000);

  it('creates a vault, rejects 3 wrong passwords, then unlocks', async () => {
    const dir = newDir();
    dirs.push(dir);
    const created = await runCli(dir, 'y\nPassword123!\nPassword123!\n5\n');
    expect(created.code).toBe(0);
    expect(created.stdout).toContain('Vault created.');
    expect(created.stdout).toContain('Goodbye.');

    const wrong = await runCli(dir, 'wrongpass1\nwrongpass2\nwrongpass3\n');
    expect(wrong.code).toBe(1);
    expect(wrong.stdout).toContain('Attempts left: 2.');
    expect(wrong.stdout).toContain('Attempts left: 1.');
    expect(wrong.stdout).toContain('Too many failed attempts.');

    const unlocked = await runCli(dir, 'Password123!\n5\n');
    expect(unlocked.code).toBe(0);
    expect(unlocked.stdout).toContain('Vault unlocked.');
  }, 180_000);

  it('supports project and resource CRUD plus search via the menus', async () => {
    const { code, stdout } = await runCli(
      crudDir,
      [
        'y', // create vault
        'Password123!',
        'Password123!',
        '1', // Projects
        '1', // Create project
        'Karimoff',
        'Personal website project',
        '2', // Open project
        '1', // project #1
        '2', // Add resource
        '2', // type: Server
        'Production',
        '', // description
        '185.123.45.67', // host
        '22', // port
        'root', // username
        'S3cret!Pass', // password
        '.', // no notes
        '1', // View resources
        '1', // resource #1
        'n', // do not show secrets
        '', // press Enter
        '', // back to resource pick -> cancel
        '5', // Search in project
        '185.123.45.67',
        '6', // Back
        '5', // Back (projects)
        '2', // global Search
        'Production',
        '', // do not open project
        '5', // Exit
      ].join('\n') + '\n',
    );
    expect(code).toBe(0);
    expect(stdout).toContain('PROJECT: Karimoff');
    expect(stdout).toContain('added.');
    expect(stdout).toContain('185.123.45.67');
    expect(stdout).toContain('********');
    expect(stdout).toContain('"Production"');
    expect(stdout).toContain('Search results for "Production"');
    expect(stdout).toContain('Karimoff');
    expect(stdout).not.toContain('S3cret!Pass');
  }, 180_000);

  it('agent ignores a detected credential without confirmation', async () => {
    const dir = newDir();
    dirs.push(dir);
    const { code, stdout } = await runCli(
      dir,
      [
        'y',
        'Password123!',
        'Password123!',
        '1', // Projects
        '1', // Create project
        'TestProj',
        '',
        '5', // Back
        '3', // Agent
        '1', // Scan pasted text
        'ssh root@203.0.113.5',
        '.',
        'n', // Ignore
        '3', // Back (agent)
        '1', // Projects
        '2', // Open project
        '1', // project #1
        '1', // View resources
        '', // press Enter
        '6', // Back
        '5', // Back
        '5', // Exit
      ].join('\n') + '\n',
    );
    expect(code).toBe(0);
    expect(stdout).toContain('DEVVAULT DETECTION');
    expect(stdout).toContain('Type: ssh');
    expect(stdout).toContain('Confidence: 95%');
    expect(stdout).toContain('(no resources)');
  }, 180_000);

  it('agent saves a detected credential after explicit confirmation', async () => {
    const dir = newDir();
    dirs.push(dir);
    const { code, stdout } = await runCli(
      dir,
      [
        'y', // create vault
        'Password123!',
        'Password123!',
        '1', // Projects
        '1', // Create project
        'WebApp',
        '',
        '5', // Back
        '3', // Agent
        '1', // Scan pasted text
        'postgres://admin:Sup3rPass@198.51.100.7:5432/shopdb',
        '.',
        'y', // Save
        '1', // project #1
        '1', // Projects
        '2', // Open project
        '1', // project #1
        '1', // View resources
        '1', // resource #1
        'n', // do not show secrets
        '', // press Enter
        '', // cancel pick
        '6', // Back
        '5', // Back
        '5', // Exit
      ].join('\n') + '\n',
    );
    expect(code).toBe(0);
    expect(stdout).toContain('Type: database');
    expect(stdout).toContain('Confidence: 90%');
    expect(stdout).toContain('Saved database');
    expect(stdout).toContain('198.51.100.7');
    expect(stdout).toContain('********');
    expect(stdout).not.toContain('Sup3rPass');
  }, 180_000);

  it('has a database file that never contains plaintext secrets', () => {
    const dbPath = join(crudDir, 'devvault.db');
    expect(existsSync(dbPath)).toBe(true);
    const content = readFileSync(dbPath);
    expect(content.includes('S3cret!Pass')).toBe(false);
    expect(content.includes('Sup3rPass')).toBe(false);
    expect(content.includes('Password123!')).toBe(false);
    expect(content.includes('DEVVAULT_VERIFIER')).toBe(false);
  });
});
