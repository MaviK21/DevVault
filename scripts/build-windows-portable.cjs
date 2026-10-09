const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const releaseRoot = path.join(root, 'release');
const stage = path.join(releaseRoot, 'DevVault-Windows-x64');
const archive = path.join(releaseRoot, 'DevVault-Windows-x64.zip');
const packageJson = require(path.join(root, 'package.json'));
const nodeModules = path.join(root, 'node_modules');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function copyTree(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (entry) => {
      const relative = path.relative(source, entry);
      return !relative.split(path.sep).some((part) => part === '.git' || part === 'test' || part === 'tests' || part.endsWith('.test.ts'));
    },
  });
}

function productionPackagePaths() {
  const npmCli = process.env.npm_execpath;
  const command = npmCli === undefined ? (process.platform === 'win32' ? 'npm.cmd' : 'npm') : process.execPath;
  const args = npmCli === undefined
    ? ['ls', '--omit=dev', '--all', '--parseable']
    : [npmCli, 'ls', '--omit=dev', '--all', '--parseable'];
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: npmCli === undefined && process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ls failed: ${result.stderr || result.stdout}`);
  }
  return [...new Set(result.stdout.split(/\r?\n/).filter(Boolean))].filter((entry) => {
    const relative = path.relative(nodeModules, entry);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  });
}

function copyProductionDependencies() {
  for (const source of productionPackagePaths()) {
    const relative = path.relative(nodeModules, source);
    const destination = path.join(stage, 'node_modules', relative);
    if (!fs.existsSync(source)) throw new Error(`Production dependency is missing: ${source}`);
    copyTree(source, destination);
  }
  const metadata = {
    name: packageJson.name,
    version: packageJson.version,
    private: true,
    main: 'dist/index.js',
    dependencies: packageJson.dependencies,
  };
  fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(metadata, null, 2)}\n`);
}

function writeLauncher() {
  const content = `@echo off\r\nif /i not "%~1"=="--console" (\r\n  start "DevVault" "%ComSpec%" /c call "%~f0" --console\r\n  exit /b\r\n)\r\nsetlocal\r\nset "DEVVAULT_PORTABLE=1"\r\n"%~dp0node.exe" "%~dp0dist\\index.js"\r\nset "DEVVAULT_EXIT=%ERRORLEVEL%"\r\nif not "%DEVVAULT_EXIT%"=="0" (\r\n  echo.\r\n  echo DevVault завершился с ошибкой (код %DEVVAULT_EXIT%).\r\n  pause\r\n)\r\nendlocal & exit /b %DEVVAULT_EXIT%\r\n`;
  fs.writeFileSync(path.join(stage, 'Запустить DevVault.bat'), content, 'utf8');
}

function writeInstructions() {
  const content = `# DevVault для Windows\n\n1. Распакуйте ZIP в удобное место.\n2. Дважды щёлкните «Запустить DevVault.bat». Node.js устанавливать не нужно.\n3. При первом запуске создайте хранилище и задайте мастер-пароль. База будет храниться в \`%LOCALAPPDATA%\\DevVault\\devvault.db\`.\n\nЧтобы удалить программу, закройте её и удалите распакованную папку. Для полного удаления базы и всех сохранённых данных отдельно удалите \`%LOCALAPPDATA%\\DevVault\`; это действие безвозвратно удалит данные.\n`;
  fs.writeFileSync(path.join(stage, 'ИНСТРУКЦИЯ.md'), content, 'utf8');
}

function createArchive() {
  fs.rmSync(archive, { force: true });
  const escapedStage = stage.replace(/'/g, "''");
  const escapedArchive = archive.replace(/'/g, "''");
  const script = `$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath '${escapedStage}' -DestinationPath '${escapedArchive}' -Force`;
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { shell: false });
}

function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Сборку Windows x64 необходимо выполнять на Windows x64 с установленными нативными production-зависимостями.');
  }
  run(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(root, 'tsconfig.json')]);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.copyFileSync(process.execPath, path.join(stage, 'node.exe'));
  copyTree(path.join(root, 'dist'), path.join(stage, 'dist'));
  copyProductionDependencies();
  writeLauncher();
  writeInstructions();
  createArchive();
  console.log(`Папка дистрибутива: ${stage}`);
  console.log(`ZIP-архив: ${archive}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}