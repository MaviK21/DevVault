import { encrypt, decrypt } from '../crypto/crypto';
import { nowIso } from '../database/database';
import type { Db } from '../database/database';
import { NotFoundError, ValidationError } from '../errors';
import type { Resource, ResourceField, ResourceType } from '../types/resource';
import { isResourceType } from '../types/resource';
import { escapeLike } from '../project/projectRepository';
import { getResourceTypeDef, validateFieldValue } from './resource';

interface ResourceRow {
  id: number;
  project_id: number;
  type: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface FieldRow {
  field_name: string;
  value: string;
  is_secret: number;
}

function mapResource(row: ResourceRow): Resource {
  if (!isResourceType(row.type)) {
    throw new ValidationError(`В базе данных указан неизвестный тип ресурса: ${row.type}`);
  }
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapField(row: FieldRow): ResourceField {
  return { fieldName: row.field_name, value: row.value, isSecret: row.is_secret !== 0 };
}

export function createResource(
  db: Db,
  key: Buffer,
  projectId: number,
  type: ResourceType,
  name: string,
  description: string,
  fields: Readonly<Record<string, string>>,
): Resource {
  const def = getResourceTypeDef(type);
  if (name.trim() === '') {
    throw new ValidationError('Название ресурса не должно быть пустым.');
  }
  for (const fieldDef of def.fields) {
    if (fieldDef.required && (fields[fieldDef.name] ?? '').trim() === '') {
      throw new ValidationError(`Поле «${fieldDef.label}» обязательно для ресурса «${def.label}».`);
    }
  }
  const now = nowIso();
  const tx = db.transaction((): number => {
    const info = db
      .prepare(
        'INSERT INTO resources (project_id, type, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(projectId, type, name.trim(), description.trim(), now, now);
    const resourceId = Number(info.lastInsertRowid);
    const insert = db.prepare(
      'INSERT INTO resource_fields (resource_id, field_name, value, is_secret) VALUES (?, ?, ?, ?)',
    );
    for (const fieldDef of def.fields) {
      const raw = fields[fieldDef.name];
      if (raw === undefined || raw === '') {
        continue;
      }
      validateFieldValue(fieldDef, raw);
      insert.run(resourceId, fieldDef.name, fieldDef.secret ? encrypt(key, raw) : raw, fieldDef.secret ? 1 : 0);
    }
    return resourceId;
  });
  const resourceId = tx();
  const resource = getResource(db, resourceId);
  if (resource === null) {
    throw new Error('Не удалось получить созданный ресурс из базы данных.');
  }
  return resource;
}

export function listResources(db: Db, projectId: number): Resource[] {
  const rows = db
    .prepare('SELECT * FROM resources WHERE project_id = ? ORDER BY id')
    .all(projectId) as ResourceRow[];
  return rows.map(mapResource);
}

export function getResource(db: Db, id: number): Resource | null {
  const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(id) as ResourceRow | undefined;
  return row === undefined ? null : mapResource(row);
}

/** Raw fields: secret values are still ciphertext. */
export function getResourceFields(db: Db, resourceId: number): ResourceField[] {
  const rows = db
    .prepare('SELECT field_name, value, is_secret FROM resource_fields WHERE resource_id = ? ORDER BY id')
    .all(resourceId) as FieldRow[];
  return rows.map(mapField);
}

/** Fields with secret values decrypted — only on explicit user request. */
export function revealResourceFields(db: Db, key: Buffer, resourceId: number): ResourceField[] {
  return getResourceFields(db, resourceId).map((field) =>
    field.isSecret ? { ...field, value: decrypt(key, field.value) } : field,
  );
}

export function hasSecrets(fields: readonly ResourceField[]): boolean {
  return fields.some((field) => field.isSecret);
}

export interface ResourceChanges {
  name?: string;
  description?: string;
  /** null = keep current value, '' = remove field, non-empty = set value */
  fields?: Readonly<Record<string, string | null>>;
}

export function updateResource(db: Db, key: Buffer, resourceId: number, changes: ResourceChanges): Resource {
  const existing = getResource(db, resourceId);
  if (existing === null) {
    throw new NotFoundError(`Ресурс №${resourceId} не найден.`);
  }
  const def = getResourceTypeDef(existing.type);
  const now = nowIso();
  db.transaction(() => {
    if (changes.name !== undefined && changes.name.trim() !== '') {
      db.prepare('UPDATE resources SET name = ?, updated_at = ? WHERE id = ?').run(
        changes.name.trim(),
        now,
        resourceId,
      );
    }
    if (changes.description !== undefined && changes.description.trim() !== '') {
      db.prepare('UPDATE resources SET description = ?, updated_at = ? WHERE id = ?').run(
        changes.description.trim(),
        now,
        resourceId,
      );
    }
    const fieldChanges = changes.fields ?? {};
    const upsert = db.prepare(
      `INSERT INTO resource_fields (resource_id, field_name, value, is_secret) VALUES (?, ?, ?, ?)
       ON CONFLICT(resource_id, field_name) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret`,
    );
    const remove = db.prepare('DELETE FROM resource_fields WHERE resource_id = ? AND field_name = ?');
    for (const fieldDef of def.fields) {
      if (!(fieldDef.name in fieldChanges)) {
        continue;
      }
      const value = fieldChanges[fieldDef.name];
      if (value === null || value === undefined) {
        continue;
      }
      if (value === '') {
        remove.run(resourceId, fieldDef.name);
        continue;
      }
      validateFieldValue(fieldDef, value);
      upsert.run(resourceId, fieldDef.name, fieldDef.secret ? encrypt(key, value) : value, fieldDef.secret ? 1 : 0);
    }
  })();
  const updated = getResource(db, resourceId);
  if (updated === null) {
    throw new NotFoundError(`Ресурс №${resourceId} не найден.`);
  }
  return updated;
}

export function deleteResource(db: Db, resourceId: number): boolean {
  const info = db.prepare('DELETE FROM resources WHERE id = ?').run(resourceId);
  return info.changes > 0;
}

export interface ResourceSearchMatch {
  resource: Resource;
  projectName: string;
  matchedField: string | null;
  matchedValue: string | null;
}

/**
 * Full-text-ish search over resource name, description and NON-SECRET field
 * values only. Secret field values are never matched and never displayed (ТЗ §28).
 */
export function searchResources(db: Db, query: string, projectId: number | null): ResourceSearchMatch[] {
  const like = `%${escapeLike(query)}%`;
  const rows = db
    .prepare(
      `SELECT r.*, p.name AS project_name
       FROM resources r
       JOIN projects p ON p.id = r.project_id
       WHERE (@projectId IS NULL OR r.project_id = @projectId)
         AND (
           r.name LIKE @like ESCAPE '\\'
           OR r.description LIKE @like ESCAPE '\\'
           OR EXISTS (
             SELECT 1 FROM resource_fields rf
             WHERE rf.resource_id = r.id AND rf.is_secret = 0 AND rf.value LIKE @like ESCAPE '\\'
           )
         )
       ORDER BY r.id`,
    )
    .all({ projectId, like }) as Array<ResourceRow & { project_name: string }>;
  const lowerQuery = query.toLowerCase();
  return rows.map((row) => {
    const resource = mapResource(row);
    const fieldRow = db
      .prepare(
        `SELECT field_name, value FROM resource_fields
         WHERE resource_id = ? AND is_secret = 0 AND value LIKE ? ESCAPE '\\'
         LIMIT 1`,
      )
      .get(resource.id, like) as FieldRow | undefined;
    const nameMatched = resource.name.toLowerCase().includes(lowerQuery);
    return {
      resource,
      projectName: row.project_name,
      matchedField: fieldRow !== undefined ? fieldRow.field_name : nameMatched ? 'name' : null,
      matchedValue: fieldRow !== undefined ? fieldRow.value : nameMatched ? resource.name : null,
    };
  });
}
