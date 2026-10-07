import * as out from '../cli/output';
import type { Detection } from '../agent/classifier';

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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
  out.print('DEVVAULT DETECTION');
  out.print('========================================');
  out.print('');
  out.print('NEW CREDENTIAL');
  out.print('');
  out.print(`Type: ${detection.type}`);
  out.print(`Source: ${detection.source}`);
  out.print(`Context: ${out.truncate(out.maskValues(detection.context, secretValues), 120)}`);
  for (const [name, value] of Object.entries(detection.fields)) {
    const shown = isSecretFieldName(name) ? `${SECRET_MASK} (hidden, will be encrypted)` : value;
    out.print(`${capitalize(name)}: ${shown}`);
  }
  out.print(`Name: ${detection.suggestedName}`);
  out.print(`Confidence: ${Math.round(detection.confidence * 100)}%`);
  out.print('');
  out.print('[Y] Save   [N] Ignore   [E] Edit');
}
