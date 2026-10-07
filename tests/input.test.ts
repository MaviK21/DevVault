import { describe, expect, it } from 'vitest';
import { parseYesNo } from '../src/cli/input';
import { validateProjectName } from '../src/project/project';
import { validateFieldValue } from '../src/resource/resource';
import { ValidationError } from '../src/errors';

describe('input helpers', () => {
  it('parses Y/N answers per the CLI contract', () => {
    expect(parseYesNo('y')).toBe(true);
    expect(parseYesNo('Y')).toBe(true);
    expect(parseYesNo(' yes ')).toBe(true);
    expect(parseYesNo('n')).toBe(false);
    expect(parseYesNo('N')).toBe(false);
    expect(parseYesNo('no')).toBe(false);
    expect(parseYesNo('')).toBeNull();
    expect(parseYesNo('maybe')).toBeNull();
    expect(parseYesNo('1')).toBeNull();
  });
});

describe('validation helpers', () => {
  it('validates project names', () => {
    expect(() => validateProjectName('')).toThrow(ValidationError);
    expect(() => validateProjectName('   ')).toThrow(ValidationError);
    expect(() => validateProjectName('x'.repeat(201))).toThrow(ValidationError);
    expect(validateProjectName('Karimoff')).toBeUndefined();
  });

  it('validates port fields', () => {
    const port = { name: 'port', label: 'Port', secret: false, required: false, multiline: false, kind: 'port' as const };
    expect(validateFieldValue(port, '22')).toBeUndefined();
    expect(validateFieldValue(port, '65535')).toBeUndefined();
    expect(() => validateFieldValue(port, '0')).toThrow(ValidationError);
    expect(() => validateFieldValue(port, '65536')).toThrow(ValidationError);
    expect(() => validateFieldValue(port, 'abc')).toThrow(ValidationError);
    expect(() => validateFieldValue(port, '')).toThrow(ValidationError);
  });
});
