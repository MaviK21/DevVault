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
      out.print('\nVault not found.');
      const create = await input.confirm('Create a new Vault?');
      if (!create) {
        out.print('\nVault was not created. Goodbye.');
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
    password = await input.askSecret('Master password: ');
    const confirmPassword = await input.askSecret('Confirm password: ');
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
  out.print('\nVault created.');
  const key = await vault.unlockVault(db, password);
  if (key === null) {
    // Cannot happen right after creation; kept for type-safety.
    throw new Error('Failed to unlock the freshly created vault.');
  }
  return key;
}

async function unlockFlow(db: Db): Promise<Buffer> {
  for (let attempt = 1; attempt <= MAX_UNLOCK_ATTEMPTS; attempt += 1) {
    const password = await input.askSecret('Master password: ');
    const key = await vault.unlockVault(db, password);
    if (key !== null) {
      out.print('\nVault unlocked.');
      return key;
    }
    const left = MAX_UNLOCK_ATTEMPTS - attempt;
    if (left > 0) {
      out.printError(`Invalid master password. Attempts left: ${left}.`);
    }
  }
  out.printError('Too many failed attempts. Exiting.');
  process.exit(1);
}

async function mainMenu(db: Db, key: Buffer): Promise<void> {
  for (;;) {
    const action = await showMenu('DEVVAULT', [
      { key: '1', label: 'Projects' },
      { key: '2', label: 'Search' },
      { key: '3', label: 'Agent (detect credentials)' },
      { key: '4', label: 'Lock' },
      { key: '5', label: 'Exit' },
    ]);
    if (action === '5') {
      vault.lockVault(key);
      out.print('\nGoodbye.');
      return;
    }
    if (action === '4') {
      vault.lockVault(key);
      out.print('\nVault locked.');
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
  out.print('\nProjects:');
  if (list.length === 0) {
    out.print('  (no projects yet)');
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
      { key: '1', label: 'Create project' },
      { key: '2', label: 'Open project' },
      { key: '3', label: 'Edit project' },
      { key: '4', label: 'Delete project' },
      { key: '5', label: 'Back' },
    ]);
    if (action === '5') {
      return;
    }
    try {
      if (action === '1') {
        await createProjectFlow(db);
      } else if (action === '2') {
        const picked = await pickById(list, 'project');
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
  const name = await input.askRequired('Project name: ');
  const description = await input.ask('Description (optional): ');
  const project = projects.createProject(db, name, description);
  out.print(`\nProject "${project.name}" created.`);
}

async function editProjectFlow(db: Db, list: readonly Project[]): Promise<void> {
  const picked = await pickById(list, 'project');
  if (picked === null) {
    return;
  }
  out.print('\nLeave a value empty to keep the current one.');
  const name = await input.ask(`Name [${picked.name}]: `);
  const description = await input.ask(`Description [${picked.description || '(none)'}]: `);
  const updated = projects.updateProject(
    db,
    picked.id,
    name.trim() === '' ? picked.name : name,
    description.trim() === '' ? picked.description : description,
  );
  out.print(`\nProject "${updated.name}" updated.`);
}

async function deleteProjectFlow(db: Db, list: readonly Project[]): Promise<void> {
  const picked = await pickById(list, 'project');
  if (picked === null) {
    return;
  }
  const confirmed = await input.confirm(
    `Delete project "${picked.name}" and ALL its resources? This cannot be undone.`,
  );
  if (!confirmed) {
    out.print('Deletion cancelled.');
    return;
  }
  projects.deleteProject(db, picked.id);
  out.print(`\nProject "${picked.name}" deleted.`);
}

function resourceTypeLabel(type: string): string {
  return RESOURCE_TYPE_DEFS.find((def) => def.type === type)?.label ?? type;
}

function printResourceList(list: readonly Resource[]): void {
  out.print('\nResources:');
  if (list.length === 0) {
    out.print('  (no resources)');
    return;
  }
  for (const resource of list) {
    out.print(`  ${resource.id}. [${resourceTypeLabel(resource.type)}] ${resource.name}`);
  }
}

async function projectMenu(db: Db, key: Buffer, project: Project): Promise<void> {
  for (;;) {
    const action = await showMenu(`PROJECT: ${project.name}`, [
      { key: '1', label: 'View resources' },
      { key: '2', label: 'Add resource' },
      { key: '3', label: 'Edit resource' },
      { key: '4', label: 'Delete resource' },
      { key: '5', label: 'Search in project' },
      { key: '6', label: 'Back' },
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
  out.print('\nResource type:');
  const typeOptions = RESOURCE_TYPE_DEFS.map((def, index) => ({
    key: String(index + 1),
    label: def.label,
  }));
  const chosenKey = await input.chooseOption('Select an action: ', typeOptions);
  const def = RESOURCE_TYPE_DEFS[Number(chosenKey) - 1];
  const name = await input.askRequired('Name: ');
  const description = await input.ask('Description (optional): ');
  const fields: Record<string, string> = {};
  for (const fieldDef of def.fields) {
    const value = await promptFieldValue(fieldDef);
    if (value !== '') {
      fields[fieldDef.name] = value;
    }
  }
  const resource = resources.createResource(db, key, project.id, def.type, name, description, fields);
  out.print(`\n${resourceTypeLabel(resource.type)} "${resource.name}" added.`);
}

async function viewResourcesFlow(db: Db, key: Buffer, project: Project): Promise<void> {
  for (;;) {
    const list = resources.listResources(db, project.id);
    printResourceList(list);
    if (list.length === 0) {
      await input.pressEnter();
      return;
    }
    const picked = await pickById(list, 'resource');
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
  out.print(`Resource #${resource.id}: ${resource.name} (${def.label})`);
  out.printDivider();
  out.print(`Name: ${resource.name}`);
  out.print(`Description: ${resource.description || '(none)'}`);
  for (const field of fields) {
    const label = labels.get(field.fieldName) ?? field.fieldName;
    out.print(`${label}: ${field.isSecret ? '********' : field.value}`);
  }
  const secretFields = fields.filter((field) => field.isSecret);
  if (secretFields.length > 0) {
    const show = await input.confirm('Show secrets?');
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
    out.print('No resources in this project.');
    return;
  }
  printResourceList(list);
  const picked = await pickById(list, 'resource');
  if (picked === null) {
    return;
  }
  const def = getResourceTypeDef(picked.type);
  const currentFields = resources.getResourceFields(db, picked.id);
  const current = new Map(currentFields.map((field) => [field.fieldName, field.value]));
  out.print(`\nEditing ${def.label} "${picked.name}" (#${picked.id}).`);
  out.print('Leave a value empty to keep the current one.');
  const name = await input.ask(`Name [${picked.name}]: `);
  const description = await input.ask(`Description [${picked.description || '(none)'}]: `);
  const changes: Record<string, string | null> = {};
  for (const fieldDef of def.fields) {
    const hasCurrent = current.has(fieldDef.name);
    if (fieldDef.multiline) {
      const change = await input.confirm(`Change ${fieldDef.label}?`);
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
      out.print(`${fieldDef.label}: ${hasCurrent ? '********' : '(not set)'}`);
      const value = await input.askSecret(`${fieldDef.label} (empty to keep): `);
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
  out.print('\nResource updated.');
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
    out.print('No resources in this project.');
    return;
  }
  printResourceList(list);
  const picked = await pickById(list, 'resource');
  if (picked === null) {
    return;
  }
  const confirmed = await input.confirm(`Delete resource "${picked.name}"? This cannot be undone.`);
  if (!confirmed) {
    out.print('Deletion cancelled.');
    return;
  }
  resources.deleteResource(db, picked.id);
  out.print(`\nResource "${picked.name}" deleted.`);
}

async function searchMenu(db: Db, key: Buffer, projectId: number | null): Promise<void> {
  const query = (await input.ask('\nSearch: ')).trim();
  if (query === '') {
    return;
  }
  const projectMatches = projectId === null ? projects.searchProjects(db, query) : [];
  const resourceMatches = resources.searchResources(db, query, projectId);
  if (projectMatches.length === 0 && resourceMatches.length === 0) {
    out.print('Nothing found.');
    return;
  }
  out.print(`\nSearch results for "${query}":`);
  if (projectMatches.length > 0) {
    out.print('\nProjects:');
    for (const project of projectMatches) {
      const description = project.description !== '' ? ` — ${project.description}` : '';
      out.print(`  ${project.id}. ${project.name}${description}`);
    }
  }
  if (resourceMatches.length > 0) {
    out.print('\nResources:');
    for (const match of resourceMatches) {
      const where =
        match.matchedField !== null && match.matchedValue !== null
          ? ` — ${match.matchedField}: ${match.matchedValue}`
          : '';
      out.print(`  [${match.projectName}] ${resourceTypeLabel(match.resource.type)} "${match.resource.name}"${where}`);
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
  const picked = await pickById(openable, 'project to open');
  if (picked !== null) {
    await projectMenu(db, key, picked);
  }
}

async function agentMenu(db: Db, key: Buffer): Promise<void> {
  for (;;) {
    const action = await showMenu('DEVVAULT AGENT', [
      { key: '1', label: 'Scan pasted text' },
      { key: '2', label: 'Scan a .env file' },
      { key: '3', label: 'Back' },
    ]);
    if (action === '3') {
      return;
    }
    if (action === '1') {
      const text = await input.askMultiline('Paste text:');
      await runScan(db, key, 'text input', text);
      continue;
    }
    if (action === '2') {
      const path = (await input.ask('Path to .env file: ')).trim();
      if (path === '') {
        continue;
      }
      try {
        const text = await readFile(path, 'utf8');
        await runScan(db, key, `.env file ${basename(path)}`, text);
      } catch (error) {
        out.printError(`Cannot read file: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
