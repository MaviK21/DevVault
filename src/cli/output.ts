const stdout = process.stdout;

export function print(text = ''): void {
  stdout.write(text + '\n');
}

export function printError(message: string): void {
  print(`ERROR: ${message}`);
}

export function printBanner(): void {
  print('================================');
  print('          DEVVAULT');
  print('================================');
}

export function printDivider(): void {
  print('--------------------------------');
}

export function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength - 1) + '…';
}

/** Replaces occurrences of the given secret values with the mask. */
export function maskValues(text: string, secrets: readonly string[], mask = '********'): string {
  let result = text;
  for (const secret of secrets) {
    if (secret !== '') {
      result = result.split(secret).join(mask);
    }
  }
  return result;
}
