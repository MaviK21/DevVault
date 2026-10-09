import fs from 'node:fs';
import os from 'node:os';
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
 * Папка данных: LocalAppData для portable-сборки, иначе <корень проекта>/data.
 * DEVVAULT_DATA_DIR всегда имеет приоритет (используется тестами и разработкой).
 */
export function resolveDataDir(): string {
  const override = process.env.DEVVAULT_DATA_DIR;
  if (override !== undefined && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  if (process.env.DEVVAULT_PORTABLE === '1' && process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData !== undefined && localAppData.trim() !== '') {
      return path.join(localAppData, 'DevVault');
    }
    return path.join(os.homedir(), 'AppData', 'Local', 'DevVault');
  }
  return path.join(findProjectRoot(__dirname), 'data');
}
