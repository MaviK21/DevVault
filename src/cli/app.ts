import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import * as input from './input';
import { pickById, showMenu } from './menu';
import * as out from './output';
import { promptFieldValue } from './fields';
import { openDatabase } from '../database/database';
import { runMigrations } from '../database/migrations';
import { resolveDataDir } from '../paths';
import type { Db } from '../database/database';
import { ValidationError } from '../errors';
import { RESOURCE_TYPE_DEFS, getResourceTypeDef, validateFieldValue } from '../resource/resource';
import * as resources from '../resource/resourceRepository';
import { DuplicateProjectError } from '../project/project';
import * as projects from '../project/projectRepository';
import type { Project } from '../types/project';
import type { Resource } from '../types/resource';
import * as vault from '../vault/vault';
import { runScan } from '../agent/agent';
import type { FieldDef } from '../resource/resource';

const MAX_UNLOCK_ATTEMPTS = 3;

export async function run(): Promise<void> {
  out.printBanner();
  const dbPath = join(resolveDataDir(), 'devvault.db');
  const db = openDatabase(dbPath);
  try {
    runMigrations(db);
    let key: Buffer;
    if (!vault.vaultExists(db)) {
      out.print('\nХранилище не найдено.');
      const create = await input.confirm('Создать новое хранилище?');
      if (!create) {
        out.print('\nХранилище не создано. До свидания.');
        return;
      }
      key = await createVaultFlow(db);
    } else {
      key = await unlockFlow(db);
    }
    await mainMenu(db, key);
  } finally {
    db.close();
  }
}

async function createVaultFlow(db: Db): Promise<Buffer> {
  let password = '';
  for (;;) {
    password = await input.askSecret('Мастер-пароль: ');
    const confirmPassword = await input.askSecret('Подтвердите пароль: ');
    try {
      await vault.createVault(db, password, confirmPassword);
      break;
    } catch (error) {
      if (error instanceof ValidationError) {
        out.printError(error.message);
        continue;
      }
      throw error;
    }
  }
  out.print('\nХранилище создано.');
  const key = await vault.unlockVault(db, password);
  if (key === null) {
    // Cannot happen right after creation; kept for type-safety.
    throw new Error('Не удалось разблокировать только что созданное хранилище.');
  }
  return key;
}

async function unlockFlow(db: Db): Promise<Buffer> {
  for (let attempt = 1; attempt <= MAX_UNLOCK_ATTEMPTS; attempt += 1) {
    const password = await input.askSecret('Мастер-пароль: ');
    const key = await vault.unlockVault(db, password);
    if (key !== null) {
      out.print('\nХранилище разблокировано.');
      return key;
    }
    const left = MAX_UNLOCK_ATTEMPTS - attempt;
    if (left > 0) {
      out.printError(`Неверный мастер-пароль. Осталось попыток: ${left}.`);
    }
  }
  out.printError('Слишком много неудачных попыток. Выход.');
  process.exit(1);
}

async function mainMenu(db: Db, key: Buffer): Promise<void> {
  for (;;) {
    const action = await showMenu('DEVVAULT', [
      { key: '1', label: 'Проекты' },
      { key: '2', label: 'Поиск' },
      { key: '3', label: 'Агент (поиск данных доступа)' },
      { key: '4', label: 'Заблокировать' },
      { key: '5', label: 'Выход' },
    ]);
    if (action === '5') {
      vault.lockVault(key);
      out.print('\nДо свидания.');
      return;
    }
    if (action === '4') {
      vault.lockVault(key);
      out.print('\nХранилище заблокировано');
      key = await unlockFlow(db);
      continue;
    }
    if (action === '1') {
      await projectsMenu(db, key);
    } else if (action === '2') {
      await searchMenu(db, key, null);
    } else if (action === '3') {
      await agentMenu(db, key);
    }
  }
}

function printProjectList(list: readonly Project[]): void {
  out.print('\nПроекты:');
  if (list.length === 0) {
    out.print('  (пока нет проектов)');
    return;
  }
  for (const project of list) {
    const description = project.description !== '' ? ` — ${project.description}` : '';
    out.print(`  ${project.id}. ${project.name}${description}`);
  }
}

async function projectsMenu(db: Db, key: Buffer): Promise<void> {
  for (;;) {
    const list = projects.listProjects(db);
    printProjectList(list);
    const action = await showMenu(null, [
      { key: '1', label: 'Создать проект' },
      { key: '2', label: 'Открыть проект' },
      { key: '3', label: 'Изменить проект' },
      { key: '4', label: 'Удалить проект' },
      { key: '5', label: 'Назад' },
    ]);
    if (action === '5') {
      return;
    }
    try {
      if (action === '1') {
        await createProjectFlow(db);
      } else if (action === '2') {
        const picked = await pickById(list, 'проекта');
        if (picked !== null) {
          await projectMenu(db, key, picked);
        }
      } else if (action === '3') {
        await editProjectFlow(db, list);
      } else if (action === '4') {
        await deleteProjectFlow(db, list);
      }
    } catch (error) {
      if (error instanceof DuplicateProjectError || error instanceof ValidationError) {
        out.printError(error.message);
        continue;
      }
      throw error;
    }
  }
}

async function createProjectFlow(db: Db): Promise<void> {
  const name = await input.askRequired('Название проекта: ');
  const description = await input.ask('Описание (необязательно): ');
  const project = projects.createProject(db, name, description);
  out.print(`\nПроект «${project.name}» создан.`);
}

async function editProjectFlow(db: Db, list: readonly Project[]): Promise<void> {
  const picked = await pickById(list, 'проекта');
  if (picked === null) {
    return;
  }
  out.print('Оставьте поле пустым, чтобы сохранить текущее значение.');
  const name = await input.ask(`Название [${picked.name}]: `);
  const description = await input.ask(`Описание [${picked.description || '(не указано)'}]: `);
  const updated = projects.updateProject(
    db,
    picked.id,
    name.trim() === '' ? picked.name : name,
    description.trim() === '' ? picked.description : description,
  );
  out.print(`\nПроект «${updated.name}» изменён.`);
}

async function deleteProjectFlow(db: Db, list: readonly Project[]): Promise<void> {
  const picked = await pickById(list, 'проекта');
  if (picked === null) {
    return;
  }
  const confirmed = await input.confirm(
    `Удалить проект «${picked.name}» и все его ресурсы? Это действие нельзя отменить.`,
  );
  if (!confirmed) {
    out.print('Удаление отменено.');
    return;
  }
  projects.deleteProject(db, picked.id);
  out.print(`\nПроект «${picked.name}» удалён.`);
}

function resourceTypeLabel(type: string): string {
  return RESOURCE_TYPE_DEFS.find((def) => def.type === type)?.label ?? type;
}

function resourceFieldLabel(type: Resource['type'], fieldName: string): string {
  if (fieldName === 'name') {
    return 'Название';
  }
  return getResourceTypeDef(type).fields.find((field) => field.name === fieldName)?.label ?? fieldName;
}

function printResourceList(list: readonly Resource[]): void {
  out.print('\nРесурсы:');
  if (list.length === 0) {
    out.print('  (нет ресурсов)');
    return;
  }
  for (const resource of list) {
    out.print(`  ${resource.id}. [${resourceTypeLabel(resource.type)}] ${resource.name}`);
  }
}

async function projectMenu(db: Db, key: Buffer, project: Project): Promise<void> {
  for (;;) {
    const action = await showMenu(`ПРОЕКТ: ${project.name}`, [
      { key: '1', label: 'Просмотр ресурсов' },
      { key: '2', label: 'Добавить ресурс' },
      { key: '3', label: 'Изменить ресурс' },
      { key: '4', label: 'Удалить ресурс' },
      { key: '5', label: 'Поиск в проекте' },
      { key: '6', label: 'Назад' },
    ]);
    try {
      if (action === '6') {
        return;
      } else if (action === '1') {
        await viewResourcesFlow(db, key, project);
      } else if (action === '2') {
        await addResourceFlow(db, key, project);
      } else if (action === '3') {
        await editResourceFlow(db, key, project);
      } else if (action === '4') {
        await deleteResourceFlow(db, project);
      } else if (action === '5') {
        await searchMenu(db, key, project.id);
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        out.printError(error.message);
        continue;
      }
      throw error;
    }
  }
}

async function addResourceFlow(db: Db, key: Buffer, project: Project): Promise<void> {
  out.print('\nТип ресурса:');
  const typeOptions = RESOURCE_TYPE_DEFS.map((def, index) => ({
    key: String(index + 1),
    label: def.label,
  }));
  const chosenKey = await showMenu(null, typeOptions);
  const def = RESOURCE_TYPE_DEFS[Number(chosenKey) - 1];
  const name = await input.askRequired('Название: ');
  const description = await input.ask('Описание (необязательно): ');
  const fields: Record<string, string> = {};
  for (const fieldDef of def.fields) {
    const value = await promptFieldValue(fieldDef);
    if (value !== '') {
      fields[fieldDef.name] = value;
    }
  }
  const resource = resources.createResource(db, key, project.id, def.type, name, description, fields);
  out.print(`\n${resourceTypeLabel(resource.type)} «${resource.name}» добавлен.`);
}

async function viewResourcesFlow(db: Db, key: Buffer, project: Project): Promise<void> {
  for (;;) {
    const list = resources.listResources(db, project.id);
    printResourceList(list);
    if (list.length === 0) {
      await input.pressEnter();
      return;
    }
    const picked = await pickById(list, 'ресурса');
    if (picked === null) {
      return;
    }
    await viewResourceFlow(db, key, picked);
  }
}

async function viewResourceFlow(db: Db, key: Buffer, resource: Resource): Promise<void> {
  const def = getResourceTypeDef(resource.type);
  const fields = resources.getResourceFields(db, resource.id);
  const labels = new Map(def.fields.map((fieldDef) => [fieldDef.name, fieldDef.label]));
  out.print('');
  out.printDivider();
  out.print(`Ресурс №${resource.id}: ${resource.name} (${def.label})`);
  out.printDivider();
  out.print(`Название: ${resource.name}`);
  out.print(`Описание: ${resource.description || '(не указано)'}`);
  for (const field of fields) {
    const label = labels.get(field.fieldName) ?? field.fieldName;
    out.print(`${label}: ${field.isSecret ? '********' : field.value}`);
  }
  const secretFields = fields.filter((field) => field.isSecret);
  if (secretFields.length > 0) {
    const show = await input.confirm('Показать секреты?');
    if (show) {
      const revealed = resources.revealResourceFields(db, key, resource.id);
      for (const field of revealed) {
        if (field.isSecret) {
          const label = labels.get(field.fieldName) ?? field.fieldName;
          out.print(`${label}: ${field.value}`);
        }
      }
    }
  }
  await input.pressEnter();
}

async function editResourceFlow(db: Db, key: Buffer, project: Project): Promise<void> {
  const list = resources.listResources(db, project.id);
  if (list.length === 0) {
    out.print('В этом проекте нет ресурсов.');
    return;
  }
  printResourceList(list);
  const picked = await pickById(list, 'ресурса');
  if (picked === null) {
    return;
  }
  const def = getResourceTypeDef(picked.type);
  const currentFields = resources.getResourceFields(db, picked.id);
  const current = new Map(currentFields.map((field) => [field.fieldName, field.value]));
  out.print(`\nИзменение: ${def.label} «${picked.name}» (№${picked.id}).`);
  out.print('Оставьте поле пустым, чтобы сохранить текущее значение.');
  const name = await input.ask(`Название [${picked.name}]: `);
  const description = await input.ask(`Описание [${picked.description || '(не указано)'}]: `);
  const changes: Record<string, string | null> = {};
  for (const fieldDef of def.fields) {
    const hasCurrent = current.has(fieldDef.name);
    if (fieldDef.multiline) {
      const change = await input.confirm(`Изменить поле «${fieldDef.label}»?`);
      if (!change) {
        continue;
      }
      const value = await promptFieldValue(fieldDef);
      if (value !== '') {
        changes[fieldDef.name] = value;
      }
      continue;
    }
    if (fieldDef.secret) {
      out.print(`${fieldDef.label}: ${hasCurrent ? '********' : '(не задано)'}`);
      const value = await input.askSecret(`${fieldDef.label} (пусто — оставить без изменений): `);
      if (value !== '') {
        changes[fieldDef.name] = value;
      }
      continue;
    }
    const hint = current.get(fieldDef.name) ?? fieldDef.defaultValue ?? '';
    await promptOpenFieldUpdate(fieldDef, hint, changes);
  }
  resources.updateResource(db, key, picked.id, {
    name: name.trim() === '' ? undefined : name,
    description: description.trim() === '' ? undefined : description,
    fields: changes,
  });
  out.print('\nРесурс изменён.');
}

async function promptOpenFieldUpdate(
  fieldDef: FieldDef,
  hint: string,
  changes: Record<string, string | null>,
): Promise<void> {
  for (;;) {
    const value = await input.ask(`${fieldDef.label} [${hint}]: `);
    if (value.trim() === '') {
      return; // keep current value
    }
    try {
      validateFieldValue(fieldDef, value);
    } catch (error) {
      if (error instanceof ValidationError) {
        out.printError(error.message);
        continue;
      }
      throw error;
    }
    changes[fieldDef.name] = value;
    return;
  }
}

async function deleteResourceFlow(db: Db, project: Project): Promise<void> {
  const list = resources.listResources(db, project.id);
  if (list.length === 0) {
    out.print('В этом проекте нет ресурсов.');
    return;
  }
  printResourceList(list);
  const picked = await pickById(list, 'ресурса');
  if (picked === null) {
    return;
  }
  const confirmed = await input.confirm(`Удалить ресурс «${picked.name}»? Это действие нельзя отменить.`);
  if (!confirmed) {
    out.print('Удаление отменено.');
    return;
  }
  resources.deleteResource(db, picked.id);
  out.print(`\nРесурс «${picked.name}» удалён.`);
}

async function searchMenu(db: Db, key: Buffer, projectId: number | null): Promise<void> {
  const query = (await input.ask('\nПоиск: ')).trim();
  if (query === '') {
    return;
  }
  const projectMatches = projectId === null ? projects.searchProjects(db, query) : [];
  const resourceMatches = resources.searchResources(db, query, projectId);
  if (projectMatches.length === 0 && resourceMatches.length === 0) {
    out.print('Ничего не найдено.');
    return;
  }
  out.print(`
Результаты поиска для «${query}»:`);
  if (projectMatches.length > 0) {
    out.print('\nПроекты:');
    for (const project of projectMatches) {
      const description = project.description !== '' ? ` — ${project.description}` : '';
      out.print(`  ${project.id}. ${project.name}${description}`);
    }
  }
  if (resourceMatches.length > 0) {
    out.print('\nРесурсы:');
    for (const match of resourceMatches) {
      const where =
        match.matchedField !== null && match.matchedValue !== null
          ? ` — ${resourceFieldLabel(match.resource.type, match.matchedField)}: ${match.matchedValue}`
          : '';
      out.print(`  [${match.projectName}] ${resourceTypeLabel(match.resource.type)} «${match.resource.name}»${where}`);
    }
  }
  if (projectId !== null) {
    return;
  }
  // Offer opening any project that appeared in the results.
  const openable: Project[] = [...projectMatches];
  for (const match of resourceMatches) {
    if (!openable.some((p) => p.id === match.resource.projectId)) {
      const project = projects.getProject(db, match.resource.projectId);
      if (project !== null) {
        openable.push(project);
      }
    }
  }
  const picked = await pickById(openable, 'проекта для открытия');
  if (picked !== null) {
    await projectMenu(db, key, picked);
  }
}

async function agentMenu(db: Db, key: Buffer): Promise<void> {
  for (;;) {
    const action = await showMenu('АГЕНТ DEVVAULT', [
      { key: '1', label: 'Сканировать вставленный текст' },
      { key: '2', label: 'Сканировать файл .env' },
      { key: '3', label: 'Назад' },
    ]);
    if (action === '3') {
      return;
    }
    if (action === '1') {
      const text = await input.askMultiline('Вставьте текст:');
      await runScan(db, key, 'вставленный текст', text);
      continue;
    }
    if (action === '2') {
      const path = (await input.ask('Путь к файлу .env: ')).trim();
      if (path === '') {
        continue;
      }
      try {
        const text = await readFile(path, 'utf8');
        await runScan(db, key, `файл .env ${basename(path)}`, text);
      } catch (error) {
        out.printError(`Не удалось прочитать файл: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
