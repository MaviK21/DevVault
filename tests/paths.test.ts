import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { resolveDataDir } from '../src/paths';

describe('resolveDataDir', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses DEVVAULT_DATA_DIR override before all defaults', () => {
    vi.stubEnv('DEVVAULT_DATA_DIR', 'C:\\test-data');
    vi.stubEnv('DEVVAULT_PORTABLE', '1');
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\Test\\AppData\\Local');
    expect(resolveDataDir()).toBe('C:\\test-data');
  });

  it.skipIf(process.platform !== 'win32')('uses LocalAppData for portable Windows releases', () => {
    vi.stubEnv('DEVVAULT_DATA_DIR', '');
    vi.stubEnv('DEVVAULT_PORTABLE', '1');
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\Test\\AppData\\Local');
    expect(resolveDataDir()).toBe('C:\\Users\\Test\\AppData\\Local\\DevVault');
  });

  it('uses project data directory outside portable mode', () => {
    vi.stubEnv('DEVVAULT_DATA_DIR', '');
    vi.stubEnv('DEVVAULT_PORTABLE', '');
    expect(resolveDataDir()).toBe(path.join(path.resolve(__dirname, '..'), 'data'));
  });
});