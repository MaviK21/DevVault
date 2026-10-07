import { ValidationError } from '../errors';
import type { ResourceType } from '../types/resource';

export interface FieldDef {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  multiline: boolean;
  defaultValue?: string;
  kind?: 'port';
}

export interface ResourceTypeDef {
  type: ResourceType;
  label: string;
  fields: readonly FieldDef[];
}

function field(name: string, label: string, opts: Partial<FieldDef> = {}): FieldDef {
  return { name, label, secret: false, required: false, multiline: false, ...opts };
}

/**
 * Registry of all resource types (ТЗ §15–25). Every type explicitly declares
 * which fields are secret — only those fields are ever encrypted; the rest
 * stays plaintext so it can be viewed and searched without unlocking secrets.
 */
export const RESOURCE_TYPE_DEFS: readonly ResourceTypeDef[] = [
  {
    type: 'website',
    label: 'Website',
    fields: [
      field('domain', 'Domain', { required: true }),
      field('protocol', 'Protocol', { defaultValue: 'https' }),
      field('notes', 'Notes', { multiline: true }),
    ],
  },
  {
    type: 'server',
    label: 'Server',
    fields: [
      field('host', 'Host', { required: true }),
      field('port', 'Port', { kind: 'port' }),
      field('username', 'Username'),
      field('password', 'Password', { secret: true }),
      field('notes', 'Notes', { multiline: true }),
    ],
  },
  {
    type: 'ssh',
    label: 'SSH',
    fields: [
      field('host', 'Host', { required: true }),
      field('port', 'Port', { kind: 'port' }),
      field('username', 'Username'),
      field('password', 'Password', { secret: true }),
      field('private_key', 'Private key', { secret: true, multiline: true }),
      field('notes', 'Notes', { multiline: true }),
    ],
  },
  {
    type: 'database',
    label: 'Database',
    fields: [
      field('db_type', 'Database type (postgresql / mysql / sqlite)', {
        required: true,
        defaultValue: 'postgresql',
      }),
      field('host', 'Host'),
      field('port', 'Port', { kind: 'port' }),
      field('database_name', 'Database name'),
      field('username', 'Username'),
      field('password', 'Password', { secret: true }),
      field('notes', 'Notes', { multiline: true }),
    ],
  },
  {
    type: 'api_key',
    label: 'API Key',
    fields: [
      field('service', 'Service', { required: true }),
      field('key', 'Key', { secret: true, required: true }),
      field('notes', 'Notes', { multiline: true }),
    ],
  },
  {
    type: 'cloudflare',
    label: 'Cloudflare',
    fields: [
      field('account', 'Account'),
      field('domain', 'Domain', { required: true }),
      field('api_token', 'API token', { secret: true, required: true }),
      field('notes', 'Notes', { multiline: true }),
    ],
  },
  {
    type: 'github',
    label: 'GitHub',
    fields: [
      field('repository', 'Repository', { required: true }),
      field('username', 'Username'),
      field('token', 'Token', { secret: true, required: true }),
      field('notes', 'Notes', { multiline: true }),
    ],
  },
  {
    type: 'docker',
    label: 'Docker',
    fields: [
      field('host', 'Host'),
      field('port', 'Port', { kind: 'port' }),
      field('registry', 'Registry'),
      field('username', 'Username'),
      field('password', 'Password', { secret: true }),
      field('notes', 'Notes', { multiline: true }),
    ],
  },
  {
    type: 'deployadmin',
    label: 'DeployAdmin',
    fields: [
      field('host', 'Host', { required: true }),
      field('port', 'Port', { kind: 'port' }),
      field('username', 'Username'),
      field('password', 'Password', { secret: true }),
      field('notes', 'Notes', { multiline: true }),
    ],
  },
  {
    type: 'note',
    label: 'Note',
    fields: [field('content', 'Content', { required: true, multiline: true })],
  },
];

export function getResourceTypeDef(type: ResourceType): ResourceTypeDef {
  const def = RESOURCE_TYPE_DEFS.find((d) => d.type === type);
  if (def === undefined) {
    throw new ValidationError(`Unknown resource type: ${type}`);
  }
  return def;
}

export function validateFieldValue(fieldDef: FieldDef, value: string): void {
  if (fieldDef.kind === 'port') {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ValidationError(`Port must be an integer between 1 and 65535, got "${value}".`);
    }
  }
}
