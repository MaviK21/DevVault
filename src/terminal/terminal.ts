import * as out from '../cli/output';
import type { Detection } from '../agent/classifier';
import { getResourceTypeDef } from '../resource/resource';

const SECRET_MASK = '********';

const SECRET_FIELD_PATTERN = /password|passwd|key|token|secret|private|credential/i;

const events: string[] = [];

export function logEvent(message: string): void {
  events.push(`[${new Date().toISOString()}] ${message}`);
}

export function getEvents(): readonly string[] {
  return events;
}

function isSecretFieldName(fieldName: string): boolean {
  return SECRET_FIELD_PATTERN.test(fieldName);
}

function fieldLabel(fieldName: string, type: Detection['type']): string {
  return getResourceTypeDef(type).fields.find((field) => field.name === fieldName)?.label ?? fieldName;
}

/**
 * Renders one detection event in the dedicated DevVault Terminal panel
 * (ТЗ §35). Secret field values are masked; the context line has any
 * detected secret values masked as well.
 */
export function renderDetection(detection: Detection): void {
  const secretValues = Object.entries(detection.fields)
    .filter(([name]) => isSecretFieldName(name))
    .map(([, value]) => value);
  out.print('');
  out.print('========================================');
  out.print('АГЕНТ DEVVAULT — ОБНАРУЖЕНИЕ');
  out.print('========================================');
  out.print('');
  out.print('ОБНАРУЖЕНЫ ДАННЫЕ ДОСТУПА');
  out.print('');
  out.print(`Тип: ${getResourceTypeDef(detection.type).label}`);
  out.print(`Источник: ${detection.source}`);
  out.print(`Контекст: ${out.truncate(out.maskValues(detection.context, secretValues), 120)}`);
  for (const [name, value] of Object.entries(detection.fields)) {
    const shown = isSecretFieldName(name) ? `${SECRET_MASK} (скрыто, будет зашифровано)` : value;
    out.print(`${fieldLabel(name, detection.type)}: ${shown}`);
  }
  out.print(`Название: ${detection.suggestedName}`);
  out.print(`Уверенность: ${Math.round(detection.confidence * 100)}%`);
  out.print('');
  out.print('[Y] Сохранить   [N] Игнорировать   [E] Изменить');
}
