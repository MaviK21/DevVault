import { spawn as ptySpawn } from 'node-pty';
import type { IPty } from 'node-pty';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const projectRoot = resolve(__dirname, '..');
const tsxCli = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function entryArgs(): { file: string; args: string[] } {
  // Prefer the built artifact (npm run build), fall back to tsx.
  if (existsSync(join(projectRoot, 'dist', 'index.js'))) {
    return { file: process.execPath, args: [join(projectRoot, 'dist', 'index.js')] };
  }
  return { file: process.execPath, args: [tsxCli, join(projectRoot, 'src', 'index.ts')] };
}

/** A real pseudo-console session (ConPTY) — stdin is a TTY, raw mode is active. */
class PtySession {
  private output = '';
  private exitPromise: Promise<number> | null = null;
  private readonly proc: IPty;

  constructor(dataDir: string) {
    const { file, args } = entryArgs();
    this.proc = ptySpawn(file, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: projectRoot,
      env: { ...process.env, DEVVAULT_DATA_DIR: dataDir } as Record<string, string>,
    });
    this.proc.onData((data: string) => {
      this.output += data;
    });
  }

  write(data: string): void {
    this.proc.write(data);
  }

  get text(): string {
    return this.output;
  }

  async waitFor(text: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.output.includes(text)) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for "${text}". Output so far:\n${this.output}`);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }

  waitForExit(timeoutMs = 20_000): Promise<number> {
    if (this.exitPromise === null) {
      this.exitPromise = new Promise<number>((resolvePromise, rejectPromise) => {
        const timer = setTimeout(
          () => rejectPromise(new Error(`Timed out waiting for exit. Output:\n${this.output}`)),
          timeoutMs,
        );
        this.proc.onExit(({ exitCode }) => {
          clearTimeout(timer);
          resolvePromise(exitCode);
        });
      });
    }
    return this.exitPromise;
  }

  kill(): void {
    this.proc.kill();
  }
}

function newDir(): string {
  return mkdtempSync(join(tmpdir(), 'devvault-tty-'));
}

describe('CLI in a real pseudo-console (TTY raw mode)', () => {
  const dirs: string[] = [];
  afterAll(() => {
    dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  it('accepts Y, masks the master password, and exits cleanly', async () => {
    const dir = newDir();
    dirs.push(dir);
    const session = new PtySession(dir);
    try {
      await session.waitFor('Создать новое хранилище?');
      session.write('y\r');
      await session.waitFor('Мастер-пароль: ');
      session.write('Password123!');
      await session.waitFor('************'); // 12 masked characters echoed
      session.write('\r');
      await session.waitFor('Подтвердите пароль: ');
      session.write('Password123!\r');
      await session.waitFor('Хранилище создано.');
      await session.waitFor('5. Выход');
      session.write('5\r');
      await session.waitFor('До свидания.');
      expect(await session.waitForExit()).toBe(0);
      expect(session.text).not.toContain('Password123!');
    } finally {
      session.kill();
    }
  }, 60_000);

  it('supports Backspace while typing the master password', async () => {
    const dir = newDir();
    dirs.push(dir);
    const session = new PtySession(dir);
    try {
      await session.waitFor('Создать новое хранилище?');
      session.write('y\r');
      await session.waitFor('Мастер-пароль: ');
      session.write('X'); // wrong char...
      await session.waitFor('*');
      session.write('\x7f'); // ...erased with Backspace
      session.write('Password123!');
      await session.waitFor('************'); // 12 masked characters echoed
      session.write('\r');
      await session.waitFor('Подтвердите пароль: ');
      session.write('Password123!\r');
      await session.waitFor('Хранилище создано.');
      session.write('5\r');
      expect(await session.waitForExit()).toBe(0);
    } finally {
      session.kill();
    }
  }, 60_000);

  it('terminates on Ctrl+C with exit code 130', async () => {
    const dir = newDir();
    dirs.push(dir);
    const session = new PtySession(dir);
    try {
      await session.waitFor('Создать новое хранилище?');
      session.write('\x03');
      expect(await session.waitForExit()).toBe(130);
    } finally {
      session.kill();
    }
  }, 60_000);
});
