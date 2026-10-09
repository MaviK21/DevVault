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
    label: 'Веб-сайт',
    fields: [
      field('domain', 'Домен', { required: true }),
      field('protocol', 'Протокол', { defaultValue: 'https' }),
      field('notes', 'Заметки', { multiline: true }),
    ],
  },
  {
    type: 'server',
    label: 'Сервер',
    fields: [
      field('host', 'Хост', { required: true }),
      field('port', 'Порт', { kind: 'port' }),
      field('username', 'Имя пользователя'),
      field('password', 'Пароль', { secret: true }),
      field('notes', 'Заметки', { multiline: true }),
    ],
  },
  {
    type: 'ssh',
    label: 'SSH',
    fields: [
      field('host', 'Хост', { required: true }),
      field('port', 'Порт', { kind: 'port' }),
      field('username', 'Имя пользователя'),
      field('password', 'Пароль', { secret: true }),
      field('private_key', 'Приватный ключ', { secret: true, multiline: true }),
      field('notes', 'Заметки', { multiline: true }),
    ],
  },
  {
    type: 'database',
    label: 'База данных',
    fields: [
      field('db_type', 'Тип базы данных (postgresql / mysql / sqlite)', {
        required: true,
        defaultValue: 'postgresql',
      }),
      field('host', 'Хост'),
      field('port', 'Порт', { kind: 'port' }),
      field('database_name', 'Имя базы данных'),
      field('username', 'Имя пользователя'),
      field('password', 'Пароль', { secret: true }),
      field('notes', 'Заметки', { multiline: true }),
    ],
  },
  {
    type: 'api_key',
    label: 'API-ключ',
    fields: [
      field('service', 'Сервис', { required: true }),
      field('key', 'Ключ', { secret: true, required: true }),
      field('notes', 'Заметки', { multiline: true }),
    ],
  },
  {
    type: 'cloudflare',
    label: 'Cloudflare',
    fields: [
      field('account', 'Аккаунт'),
      field('domain', 'Домен', { required: true }),
      field('api_token', 'API-токен', { secret: true, required: true }),
      field('notes', 'Заметки', { multiline: true }),
    ],
  },
  {
    type: 'github',
    label: 'GitHub',
    fields: [
      field('repository', 'Репозиторий', { required: true }),
      field('username', 'Имя пользователя'),
      field('token', 'Токен', { secret: true, required: true }),
      field('notes', 'Заметки', { multiline: true }),
    ],
  },
  {
    type: 'docker',
    label: 'Docker',
    fields: [
      field('host', 'Хост'),
      field('port', 'Порт', { kind: 'port' }),
      field('registry', 'Реестр'),
      field('username', 'Имя пользователя'),
      field('password', 'Пароль', { secret: true }),
      field('notes', 'Заметки', { multiline: true }),
    ],
  },
  {
    type: 'deployadmin',
    label: 'DeployAdmin',
    fields: [
      field('host', 'Хост', { required: true }),
      field('port', 'Порт', { kind: 'port' }),
      field('username', 'Имя пользователя'),
      field('password', 'Пароль', { secret: true }),
      field('notes', 'Заметки', { multiline: true }),
    ],
  },
  {
    type: 'note',
    label: 'Заметка',
    fields: [field('content', 'Содержимое', { required: true, multiline: true })],
  },
];

export function getResourceTypeDef(type: ResourceType): ResourceTypeDef {
  const def = RESOURCE_TYPE_DEFS.find((d) => d.type === type);
  if (def === undefined) {
    throw new ValidationError(`Неизвестный тип ресурса: ${type}`);
  }
  return def;
}

export function validateFieldValue(fieldDef: FieldDef, value: string): void {
  if (fieldDef.kind === 'port') {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ValidationError(`Порт должен быть целым числом от 1 до 65535. Получено: «${value}».`);
    }
  }
}
