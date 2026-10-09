import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import * as input from '../cli/input';
import { pickById } from '../cli/menu';
import * as out from '../cli/output';
import { promptFieldValue } from '../cli/fields';
import type { Db } from '../database/database';
import { ValidationError } from '../errors';
import type { Project } from '../types/project';
import * as projects from '../project/projectRepository';
import * as resources from '../resource/resourceRepository';
import { getResourceTypeDef } from '../resource/resource';
import * as terminal from '../terminal/terminal';
import { classifyText } from './classifier';
import type { Detection } from './classifier';

export interface ProjectContext {
  project: Project | null;
  signals: string[];
}

/**
 * Best-effort project context detection (ТЗ §34): matches the current
 * directory name and the git remote URL against known project names.
 * Low confidence → null ("Unknown") and the user is asked.
 */
export function detectProjectContext(db: Db): ProjectContext {
  const signals: string[] = [];
  let remote: string | null = null;
  try {
    remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (remote !== '') {
      signals.push(`git remote: ${remote}`);
    }
  } catch {
    // no git repository or no remote — not an error
  }
  const directory = basename(process.cwd());
  const haystacks = [directory.toLowerCase(), remote === null ? '' : remote.toLowerCase()];
  const matches = projects
    .listProjects(db)
    .filter((project) => haystacks.some((hay) => hay !== '' && hay.includes(project.name.toLowerCase())));
  if (matches.length === 1) {
    signals.push('single name match');
    return { project: matches[0], signals };
  }
  return { project: null, signals };
}

/**
 * Full detection pipeline: Detect → Classify → Show → User confirmation → Save.
 * Nothing is ever saved without an explicit [Y] from the user (ТЗ §31, §35).
 */
export async function runScan(db: Db, key: Buffer, sourceName: string, text: string): Promise<void> {
  const detections = classifyText(text, sourceName);
  terminal.logEvent(`Scanned ${sourceName}: ${detections.length} candidate credential(s)`);
  if (detections.length === 0) {
    out.print('Данные доступа не обнаружены.');
    return;
  }
  for (const detection of detections) {
    const saved = await handleDetection(db, key, detection);
    if (saved) {
      terminal.logEvent(`Сохранено: ${detection.type} «${detection.suggestedName}»`);
    } else {
      terminal.logEvent(`Пропущено: ${detection.type} «${detection.suggestedName}»`);
    }
  }
}

async function handleDetection(db: Db, key: Buffer, detection: Detection): Promise<boolean> {
  for (;;) {
    terminal.renderDetection(detection);
    // chooseOption returns the option key in its original case — normalize it.
    const action = (await input.chooseOption('Действие: ', [
      { key: 'Y', label: 'Сохранить' },
      { key: 'N', label: 'Игнорировать' },
      { key: 'E', label: 'Изменить' },
    ])).toLowerCase();
    if (action === 'n') {
      return false;
    }
    if (action === 'e') {
      await editDetection(detection);
      continue;
    }
    return saveDetection(db, key, detection);
  }
}

async function editDetection(detection: Detection): Promise<void> {
  const def = getResourceTypeDef(detection.type);
  out.print('\nИзменение найденных данных. Оставьте поле пустым, чтобы сохранить текущее значение.');
  const name = await input.ask(`Название [${detection.suggestedName}]: `);
  if (name.trim() !== '') {
    detection.suggestedName = name.trim();
  }
  for (const fieldName of Object.keys(detection.fields)) {
    const fieldDef = def.fields.find((f) => f.name === fieldName);
    const label = fieldDef?.label ?? fieldName;
    const value = fieldDef !== undefined ? await promptFieldValue(fieldDef) : await input.ask(`${label}: `);
    if (value !== '') {
      detection.fields[fieldName] = value;
    }
  }
}

async function saveDetection(db: Db, key: Buffer, detection: Detection): Promise<boolean> {
  let project = await pickTargetProject(db);
  if (project === null) {
    out.print('Сохранение отменено.');
    return false;
  }
  const def = getResourceTypeDef(detection.type);
  const fields: Record<string, string> = { ...detection.fields };
  for (const fieldDef of def.fields) {
    if (fieldDef.required && (fields[fieldDef.name] ?? '').trim() === '') {
      out.printError(`Для сохранения заполните обязательное поле: ${fieldDef.label}`);
      const value = await promptFieldValue(fieldDef);
      if (value !== '') {
        fields[fieldDef.name] = value;
      }
    }
  }
  try {
    const description = `Обнаружено агентом DevVault (${detection.source})`;
    resources.createResource(db, key, project.id, detection.type, detection.suggestedName, description, fields);
    out.print(`\nСохранено: ${getResourceTypeDef(detection.type).label} «${detection.suggestedName}» в проекте «${project.name}».`);
    return true;
  } catch (error) {
    if (error instanceof ValidationError) {
      out.printError(error.message);
      return false;
    }
    throw error;
  }
}

async function pickTargetProject(db: Db): Promise<Project | null> {
  const context = detectProjectContext(db);
  if (context.project !== null) {
    out.print(`Контекст проекта: ${context.project.name}`);
    const use = await input.confirm(`Сохранить в проект «${context.project.name}»?`);
    if (use) {
      return context.project;
    }
  }
  const list = projects.listProjects(db);
  if (list.length === 0) {
    out.printError('Проектов пока нет. Сначала создайте проект (Проекты → Создать проект).');
    return null;
  }
  out.print('Проекты:');
  for (const project of list) {
    out.print(`  ${project.id}. ${project.name}`);
  }
  return pickById(list, 'проекта');
}
