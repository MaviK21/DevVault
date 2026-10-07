import { nowIso } from './database';
import type { Db } from './database';

interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * Sequential, append-only migration list. Existing migrations must never be
 * edited — add a new entry with the next id instead.
 */
const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'initial-schema',
    sql: `
      CREATE TABLE vault_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          kdf_salt TEXT NOT NULL,
          kdf_params TEXT NOT NULL,
          verifier TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
      );

      CREATE TABLE projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
      );

      CREATE TABLE resources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_resources_project_id ON resources(project_id);

      CREATE TABLE resource_fields (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
          field_name TEXT NOT NULL,
          value TEXT NOT NULL,
          is_secret INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0, 1)),
          UNIQUE (resource_id, field_name)
      );

      CREATE INDEX idx_resource_fields_resource_id ON resource_fields(resource_id);
    `,
  },
];

export function runMigrations(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
    );
  `);
  const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: number }>;
  const applied = new Set(appliedRows.map((row) => row.id));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) {
      continue;
    }
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        nowIso(),
      );
    })();
  }
}
