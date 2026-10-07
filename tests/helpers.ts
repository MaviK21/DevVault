import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database/database';
import { runMigrations } from '../src/database/migrations';
import type { Db } from '../src/database/database';

const handles: Array<{ db: Db; dir: string }> = [];

/**
 * Creates a migrated database in a fresh temp dir. The handle is registered
 * for cleanupAll(): on Windows an open SQLite file cannot be deleted, so all
 * databases are closed before their dirs are removed.
 */
export function makeDb(): { db: Db; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'devvault-test-'));
  const db = openDatabase(join(dir, 'test.db'));
  runMigrations(db);
  const handle = { db, dir };
  handles.push(handle);
  return handle;
}

export function cleanupAll(): void {
  for (const handle of handles) {
    try {
      handle.db.close();
    } catch {
      // already closed
    }
    try {
      rmSync(handle.dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  handles.length = 0;
}
