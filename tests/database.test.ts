import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/database/migrations';
import { DuplicateProjectError } from '../src/project/project';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  searchProjects,
  updateProject,
} from '../src/project/projectRepository';
import { createResource } from '../src/resource/resourceRepository';
import { ValidationError } from '../src/errors';
import { cleanupAll, makeDb } from './helpers';

describe('database migrations', () => {
  afterAll(cleanupAll);

  it('are idempotent when run repeatedly', () => {
    const { db } = makeDb();
    runMigrations(db);
    runMigrations(db);
    const applied = db.prepare('SELECT id, name FROM schema_migrations ORDER BY id').all();
    expect(applied).toEqual([{ id: 1, name: 'initial-schema' }]);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    expect(tables).toContain('vault_meta');
    expect(tables).toContain('projects');
    expect(tables).toContain('resources');
    expect(tables).toContain('resource_fields');
  });
});

describe('project repository', () => {
  afterAll(cleanupAll);

  it('performs full CRUD', () => {
    const { db } = makeDb();
    const project = createProject(db, 'Karimoff', 'Personal website project');
    expect(project.name).toBe('Karimoff');
    expect(getProject(db, project.id)?.description).toBe('Personal website project');
    expect(listProjects(db)).toHaveLength(1);

    const updated = updateProject(db, project.id, 'Karimoff v2', 'Updated');
    expect(updated.name).toBe('Karimoff v2');
    expect(getProject(db, project.id)?.name).toBe('Karimoff v2');

    expect(deleteProject(db, project.id)).toBe(true);
    expect(getProject(db, project.id)).toBeNull();
    expect(listProjects(db)).toHaveLength(0);
    expect(deleteProject(db, project.id)).toBe(false);
  });

  it('rejects duplicate names case-insensitively', () => {
    const { db } = makeDb();
    createProject(db, 'Karimoff', '');
    expect(() => createProject(db, 'karimoff', '')).toThrow(DuplicateProjectError);
    expect(() => createProject(db, 'KARIMOFF', '')).toThrow(DuplicateProjectError);
  });

  it('rejects empty names', () => {
    const { db } = makeDb();
    expect(() => createProject(db, '   ', '')).toThrow(ValidationError);
  });

  it('finds projects by search query', () => {
    const { db } = makeDb();
    createProject(db, 'Karimoff', 'Personal website');
    createProject(db, 'TestProject', '');
    expect(searchProjects(db, 'karim').map((p) => p.name)).toEqual(['Karimoff']);
    expect(searchProjects(db, 'website').map((p) => p.name)).toEqual(['Karimoff']);
    expect(searchProjects(db, 'nomatch')).toHaveLength(0);
  });
});

describe('foreign keys and cascade deletion', () => {
  afterAll(cleanupAll);

  it('forbids resources without a project', () => {
    const { db } = makeDb();
    expect(() =>
      db
        .prepare(
          "INSERT INTO resources (project_id, type, name, description, created_at, updated_at) VALUES (999, 'server', 'X', '', 't', 't')",
        )
        .run(),
    ).toThrow();
  });

  it('deletes resources together with their project (no orphans)', () => {
    const { db } = makeDb();
    const project = createProject(db, 'Karimoff', '');
    const resource1 = createResource(db, Buffer.alloc(32, 1), project.id, 'note', 'Note 1', '', {
      content: 'hello',
    });
    const resource2 = createResource(db, Buffer.alloc(32, 1), project.id, 'note', 'Note 2', '', {
      content: 'world',
    });
    deleteProject(db, project.id);
    const resourceCount = db.prepare('SELECT COUNT(*) AS n FROM resources').get() as { n: number };
    const fieldCount = db.prepare('SELECT COUNT(*) AS n FROM resource_fields').get() as { n: number };
    expect(resourceCount.n).toBe(0);
    expect(fieldCount.n).toBe(0);
    expect(resourcesLeft(db, resource1.id)).toBe(false);
    expect(resourcesLeft(db, resource2.id)).toBe(false);
  });
});

function resourcesLeft(db: import('../src/database/database').Db, id: number): boolean {
  const row = db.prepare('SELECT id FROM resources WHERE id = ?').get(id);
  return row !== undefined;
}
