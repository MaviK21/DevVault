import * as input from './input';
import * as out from './output';
import { ValidationError } from '../errors';
import { validateFieldValue } from '../resource/resource';
import type { FieldDef } from '../resource/resource';

/**
 * Prompts for one resource field value, honoring secret (hidden input),
 * multiline ("." terminator) and default/required/port rules.
 * Returns '' when the field was left empty.
 */
export async function promptFieldValue(fieldDef: FieldDef): Promise<string> {
  for (;;) {
    let value: string;
    if (fieldDef.multiline) {
      value = await input.askMultiline(`${fieldDef.label}:`, { secret: fieldDef.secret });
    } else if (fieldDef.secret) {
      value = await input.askSecret(`${fieldDef.label}: `);
    } else {
      const suffix = fieldDef.defaultValue !== undefined ? ` [${fieldDef.defaultValue}]` : '';
      value = await input.ask(`${fieldDef.label}${suffix}: `);
      if (value.trim() === '' && fieldDef.defaultValue !== undefined) {
        value = fieldDef.defaultValue;
      }
    }
    value = value.trim();
    if (value === '') {
      if (fieldDef.required) {
        out.printError(`Поле «${fieldDef.label}» обязательно.`);
        continue;
      }
      return '';
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
    return value;
  }
}
