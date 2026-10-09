import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { decrypt } from '../src/crypto/crypto';
import { createProject } from '../src/project/projectRepository';
import {
  createResource,
  deleteResource,
  getResource,
  getResourceFields,
  listResources,
  revealResourceFields,
  searchResources,
  updateResource,
} from '../src/resource/resourceRepository';
import { cleanupAll, makeDb } from './helpers';

describe('resource repository', () => {
  afterAll(cleanupAll);

  const key = randomBytes(32);

  it('stores secrets encrypted and open fields as plaintext', () => {
    const { db } = makeDb();
    const projectId = createProject(db, 'Karimoff', '').id;
    const resource = createResource(db, key, projectId, 'server', 'Production', 'Main server', {
      host: '185.123.45.67',
      port: '22',
      username: 'root',
      password: 'PlainText-Password!',
    });
    expect(resource.type).toBe('server');
    const fields = getResourceFields(db, resource.id);
    const password = fields.find((f) => f.fieldName === 'password');
    const host = fields.find((f) => f.fieldName === 'host');
    expect(password?.isSecret).toBe(true);
    expect(password?.value).not.toBe('PlainText-Password!');
    expect(decrypt(key, password!.value)).toBe('PlainText-Password!');
    expect(host?.isSecret).toBe(false);
    expect(host?.value).toBe('185.123.45.67');
  });

  it('reveals secrets only through the explicit reveal call', () => {
    const { db } = makeDb();
    const projectId = createProject(db, 'Karimoff', '').id;
    const resource = createResource(db, key, projectId, 'api_key', 'OpenAI', '', {
      service: 'OpenAI',
      key: 'sk-very-secret-key-123',
    });
    const raw = getResourceFields(db, resource.id).find((f) => f.fieldName === 'key');
    expect(raw?.value).not.toBe('sk-very-secret-key-123');
    const revealed = revealResourceFields(db, key, resource.id).find((f) => f.fieldName === 'key');
    expect(revealed?.value).toBe('sk-very-secret-key-123');
  });

  it('enforces required fields and port validation', () => {
    const { db } = makeDb();
    const projectId = createProject(db, 'Karimoff', '').id;
    expect(() =>
      createResource(db, key, projectId, 'website', 'Site', '', { protocol: 'https' }),
    ).toThrow(/Домен.*обязательно/);
    expect(() =>
      createResource(db, key, projectId, 'server', 'Bad port', '', { host: 'h', port: '99999' }),
    ).toThrow(/Порт должен быть/);
    expect(() =>
      createResource(db, key, projectId, 'server', 'Bad port', '', { host: 'h', port: 'abc' }),
    ).toThrow(/Порт должен быть/);
  });

  it('updates open fields, replaces secrets and keeps secrets on null', () => {
    const { db } = makeDb();
    const projectId = createProject(db, 'Karimoff', '').id;
    const resource = createResource(db, key, projectId, 'server', 'Production', '', {
      host: '10.0.0.1',
      username: 'root',
      password: 'OldPassword1',
    });
    const before = getResourceFields(db, resource.id).find((f) => f.fieldName === 'password');
    updateResource(db, key, resource.id, {
      name: 'Production v2',
      description: 'updated',
      fields: { host: '10.0.0.2', password: 'NewPassword2' },
    });
    let fields = getResourceFields(db, resource.id);
    expect(fields.find((f) => f.fieldName === 'host')?.value).toBe('10.0.0.2');
    expect(fields.find((f) => f.fieldName === 'password')?.value).not.toBe('OldPassword1');
    expect(fields.find((f) => f.fieldName === 'password')?.value).not.toBe(before?.value);
    expect(
      revealResourceFields(db, key, resource.id).find((f) => f.fieldName === 'password')?.value,
    ).toBe('NewPassword2');
    updateResource(db, key, resource.id, { fields: { password: null, username: '' } });
    fields = getResourceFields(db, resource.id);
    // null keeps the secret, empty string removes the open field
    expect(fields.find((f) => f.fieldName === 'password')).toBeDefined();
    expect(fields.find((f) => f.fieldName === 'username')).toBeUndefined();
    expect(
      revealResourceFields(db, key, resource.id).find((f) => f.fieldName === 'password')?.value,
    ).toBe('NewPassword2');
    expect(getResource(db, resource.id)?.name).toBe('Production v2');
  });

  it('lists and deletes resources', () => {
    const { db } = makeDb();
    const projectId = createProject(db, 'Karimoff', '').id;
    const r1 = createResource(db, key, projectId, 'note', 'N1', '', { content: 'a' });
    const r2 = createResource(db, key, projectId, 'note', 'N2', '', { content: 'b' });
    expect(listResources(db, projectId).map((r) => r.id)).toEqual([r1.id, r2.id]);
    expect(deleteResource(db, r1.id)).toBe(true);
    expect(listResources(db, projectId).map((r) => r.id)).toEqual([r2.id]);
    expect(getResource(db, r1.id)).toBeNull();
  });

  it('searches names and non-secret fields but never secret values', () => {
    const { db } = makeDb();
    const projectId = createProject(db, 'Karimoff', '').id;
    createResource(db, key, projectId, 'server', 'Production', 'Main', {
      host: '185.123.45.67',
      username: 'root',
      password: 'NeedleInSecret-zz',
    });
    // by name
    expect(searchResources(db, 'Production', null)).toHaveLength(1);
    // by non-secret field value (the ТЗ §28 example)
    const byHost = searchResources(db, '185.123.45.67', null);
    expect(byHost).toHaveLength(1);
    expect(byHost[0]?.matchedField).toBe('host');
    expect(byHost[0]?.projectName).toBe('Karimoff');
    // by username
    expect(searchResources(db, 'root', null)).toHaveLength(1);
    // secret value must NOT be matched
    expect(searchResources(db, 'NeedleInSecret-zz', null)).toHaveLength(0);
    // project filter
    expect(searchResources(db, 'Production', projectId)).toHaveLength(1);
    expect(searchResources(db, 'Production', projectId + 1)).toHaveLength(0);
    // no false positives from unrelated query
    expect(searchResources(db, 'zzznope', null)).toHaveLength(0);
  });
});
