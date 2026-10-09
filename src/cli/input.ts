import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import type { ReadStream } from 'node:tty';
import { AppError } from '../errors';

/** Thrown when stdin closes (EOF) — the app exits instead of looping on empty input. */
export class EofError extends AppError {}

const stdin = process.stdin;
const stdout = process.stdout;

let pipedIterator: AsyncIterator<string> | null = null;
let eofReached = false;

function getPipedIterator(): AsyncIterator<string> {
  if (pipedIterator === null) {
    const rl = createInterface({ input: stdin, terminal: false, crlfDelay: Infinity });
    pipedIterator = rl[Symbol.asyncIterator]();
  }
  return pipedIterator;
}

/**
 * Reads one line when stdin is NOT a terminal (piped input, used by tests and
 * scripting). A single readline interface is created for the whole process —
 * there are never two competing readers.
 */
async function readPipedLine(): Promise<string> {
  if (eofReached) {
    throw new EofError();
  }
  const iterator = getPipedIterator();
  const result = await iterator.next();
  if (result.done) {
    eofReached = true;
    throw new EofError();
  }
  return result.value;
}

/**
 * Reads one line from a Windows/Unix terminal in raw mode.
 * Supports Backspace, Enter, Ctrl+C and pasted UTF-8 text; ANSI escape
 * sequences (arrow keys etc.) are swallowed instead of corrupting the value.
 * `mask` replaces every echoed character (password input).
 */
function readTtyLine(prompt: string, mask: string | null): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let line = '';
    let inEscape = false;
    let settled = false;

    const cleanup = (): void => {
      stdin.removeListener('data', onData);
      stdin.removeListener('error', onError);
      try {
        (stdin as ReadStream).setRawMode(false);
      } catch {
        // stdin is not a TTY — nothing to restore
      }
      stdin.pause();
    };

    const settle = (finish: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      finish();
    };

    const onData = (chunk: Buffer): void => {
      const text = decoder.write(chunk);
      for (const ch of text) {
        const code = ch.codePointAt(0) ?? 0;
        if (inEscape) {
          // skip until the final byte of the escape sequence
          if ((code >= 0x40 && code <= 0x7e) || ch === '\u001b') {
            inEscape = false;
          }
          continue;
        }
        if (ch === '\u001b') {
          inEscape = true;
          continue;
        }
        if (code === 0x03) {
          // Ctrl+C: restore the terminal, then terminate the process
          settle(() => undefined);
          stdout.write('^C\n');
          process.exit(130);
        }
        if (ch === '\r' || ch === '\n') {
          stdout.write('\n');
          settle(() => resolve(line));
          return;
        }
        if (code === 0x7f || code === 0x08) {
          // Backspace
          if (line.length > 0) {
            line = line.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        if (code < 0x20) {
          continue; // ignore other control characters
        }
        line += ch;
        stdout.write(mask ?? ch);
      }
    };

    const onError = (error: Error): void => settle(() => reject(error));

    stdin.on('data', onData);
    stdin.on('error', onError);
    stdin.resume();
    try {
      (stdin as ReadStream).setRawMode(true);
    } catch {
      // stdin is not a TTY — read anyway, characters just arrive uncooked
    }
    stdout.write(prompt);
  });
}

export async function ask(prompt: string): Promise<string> {
  if (stdin.isTTY) {
    return readTtyLine(prompt, null);
  }
  return readPipedLine();
}

/** Hidden input on a real terminal; plain line reading on piped input. */
export async function askSecret(prompt: string): Promise<string> {
  if (stdin.isTTY) {
    return readTtyLine(prompt, '*');
  }
  return readPipedLine();
}

export const MULTILINE_TERMINATOR = '.';

/** Reads multiple lines until a line containing only "." (ТЗ §30). */
export async function askMultiline(prompt: string, opts: { secret?: boolean } = {}): Promise<string> {
  stdout.write(`${prompt} (для завершения введите отдельной строкой "${MULTILINE_TERMINATOR}")\n`);

  const lines: string[] = [];
  for (;;) {
    const line = opts.secret === true ? await askSecret('') : await ask('');
    if (line === MULTILINE_TERMINATOR) {
      break;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export function parseYesNo(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (value === 'y' || value === 'yes' || value === 'да') {
    return true;
  }
  if (value === 'n' || value === 'no' || value === 'нет') {
    return false;
  }
  return null;
}

export async function askRequired(prompt: string): Promise<string> {
  for (;;) {
    const value = await ask(prompt);
    if (value.trim() !== '') {
      return value.trim();
    }
    stdout.write('Это поле обязательно.\n');
  }
}

export async function confirm(question: string): Promise<boolean> {
  stdout.write(`\n${question}\n`);
  for (;;) {
    const answer = await ask('[Y] Да / [N] Нет: ');
    const parsed = parseYesNo(answer);
    if (parsed === null) {
      stdout.write('Введите Y (да) или N (нет).\n');
      continue;
    }
    return parsed;
  }
}

export async function pressEnter(prompt = 'Нажмите Enter, чтобы продолжить: '): Promise<void> {
  await ask(prompt);
}

export interface MenuOption {
  key: string;
  label: string;
}

/** Prompts until the user enters one of the allowed keys (case-insensitive). */
export async function chooseOption(prompt: string, options: readonly MenuOption[]): Promise<string> {
  for (;;) {
    const raw = (await ask(prompt)).trim().toLowerCase();
    const option = options.find((o) => o.key.toLowerCase() === raw);
    if (option !== undefined) {
      return option.key;
    }
    stdout.write(`Неверный выбор «${raw}». Допустимые варианты: ${options.map((o) => o.key).join(', ')}.\n`);
  }
}
