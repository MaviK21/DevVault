import fs from 'node:fs';
import path from 'node:path';

/** Поднимается от стартовой папки вверх, пока не найдёт package.json. */
export function findProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 15; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
  return startDir;
}

/**
 * Папка данных: <корень проекта>/data.
 * Переопределяется переменной окружения DEVVAULT_DATA_DIR (используется тестами).
 */
export function resolveDataDir(): string {
  const override = process.env.DEVVAULT_DATA_DIR;
  if (override !== undefined && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  return path.join(findProjectRoot(__dirname), 'data');
}
