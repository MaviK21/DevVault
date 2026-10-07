import { nowIso } from '../database/database';
import type { Db } from '../database/database';
import { ValidationError } from '../errors';
import type { Project } from '../types/project';
import { DuplicateProjectError, validateProjectName } from './project';

interface ProjectRow {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createProject(db: Db, name: string, description: string): Project {
  validateProjectName(name);
  const existing = findProjectByName(db, name);
  if (existing !== null) {
    throw new DuplicateProjectError(existing.name);
  }
  const now = nowIso();
  const info = db
    .prepare('INSERT INTO projects (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(name.trim(), description.trim(), now, now);
  const project = getProject(db, Number(info.lastInsertRowid));
  if (project === null) {
    throw new Error('Failed to read back the created project.');
  }
  return project;
}

export function listProjects(db: Db): Project[] {
  const rows = db.prepare('SELECT * FROM projects ORDER BY id').all() as ProjectRow[];
  return rows.map(mapProject);
}

export function getProject(db: Db, id: number): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  return row === undefined ? null : mapProject(row);
}

export function findProjectByName(db: Db, name: string): Project | null {
  const row = db
    .prepare('SELECT * FROM projects WHERE name = ? COLLATE NOCASE')
    .get(name.trim()) as ProjectRow | undefined;
  return row === undefined ? null : mapProject(row);
}

export function updateProject(db: Db, id: number, name: string, description: string): Project {
  const existing = getProject(db, id);
  if (existing === null) {
    throw new ValidationError(`Project #${id} not found.`);
  }
  validateProjectName(name);
  const duplicate = findProjectByName(db, name);
  if (duplicate !== null && duplicate.id !== id) {
    throw new DuplicateProjectError(duplicate.name);
  }
  db.prepare('UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(
    name.trim(),
    description.trim(),
    nowIso(),
    id,
  );
  const updated = getProject(db, id);
  if (updated === null) {
    throw new Error('Failed to read back the updated project.');
  }
  return updated;
}

/**
 * Deletes the project. ON DELETE CASCADE removes its resources and their
 * fields in the same transaction, so no orphan rows can remain (ТЗ §48).
 */
export function deleteProject(db: Db, id: number): boolean {
  const info = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return info.changes > 0;
}

export function searchProjects(db: Db, query: string): Project[] {
  const like = `%${escapeLike(query)}%`;
  const rows = db
    .prepare(
      `SELECT * FROM projects
       WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
       ORDER BY id`,
    )
    .all(like, like) as ProjectRow[];
  return rows.map(mapProject);
}

export function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (ch) => '\\' + ch);
}
