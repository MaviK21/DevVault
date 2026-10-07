import * as input from './input';
import * as out from './output';

export async function showMenu(title: string | null, options: readonly input.MenuOption[]): Promise<string> {
  if (title !== null) {
    out.print('');
    out.print(title);
  }
  for (const option of options) {
    out.print(`${option.key}. ${option.label}`);
  }
  return input.chooseOption('Select an action: ', options);
}

/**
 * Prompts for an item by its id (the numbers shown in the lists).
 * Returns null on empty input (cancel). Re-prompts on unknown numbers.
 */
export async function pickById<T extends { id: number }>(items: readonly T[], label: string): Promise<T | null> {
  for (;;) {
    const raw = (await input.ask(`Enter ${label} number (or empty to cancel): `)).trim();
    if (raw === '') {
      return null;
    }
    const id = Number(raw);
    const item = items.find((candidate) => candidate.id === id);
    if (item !== undefined) {
      return item;
    }
    out.printError(`No ${label} with number ${raw}.`);
  }
}
