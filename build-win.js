import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';

if (process.platform !== 'win32') throw new Error('请在 Windows 上构建发行包');

const root = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(root, 'build');
const outputDir = path.join(root, 'dist', '漫剧雷达-Windows');
const exePath = path.join(outputDir, '漫剧雷达.exe');
const runFile = promisify(execFile);

await fs.mkdir(buildDir, { recursive: true });
if (!path.resolve(outputDir).startsWith(`${path.resolve(root, 'dist')}${path.sep}`)) throw new Error('发行目录不在项目 dist 内');
await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });
await build({
  entryPoints: [path.join(root, 'server.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: path.join(buildDir, 'server.cjs'),
  logLevel: 'warning',
});

const seaConfig = {
  main: path.join(buildDir, 'server.cjs'),
  output: path.join(buildDir, 'sea.blob'),
  disableExperimentalSEAWarning: true,
};
const seaConfigPath = path.join(buildDir, 'sea-config.json');
await fs.writeFile(seaConfigPath, JSON.stringify(seaConfig));
await runFile(process.execPath, ['--experimental-sea-config', seaConfigPath], { cwd: root });
await fs.copyFile(process.execPath, exePath);
await inject(exePath, 'NODE_SEA_BLOB', await fs.readFile(seaConfig.output), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
});

await fs.cp(path.join(root, 'public'), path.join(outputDir, 'public'), { recursive: true, force: true });
await fs.mkdir(path.join(outputDir, 'components'), { recursive: true });
for (const file of ['quarkpan.exe', 'quark-login.exe']) {
  await fs.copyFile(path.join(buildDir, 'quark-components', file), path.join(outputDir, 'components', file));
}
await fs.mkdir(path.join(outputDir, 'licenses'), { recursive: true });
await fs.cp(path.join(root, 'licenses'), path.join(outputDir, 'licenses'), { recursive: true, force: true });
await fs.copyFile(path.join(root, '.venv312', 'Lib', 'site-packages', 'quarkpan-1.0.5.dist-info', 'licenses', 'LICENSE'),
  path.join(outputDir, 'licenses', 'QuarkPan-MIT.txt'));
await fs.mkdir(path.join(outputDir, 'node_modules'), { recursive: true });
await fs.cp(path.join(root, 'node_modules', 'playwright-core'), path.join(outputDir, 'node_modules', 'playwright-core'), { recursive: true });
for (const file of ['README.md']) {
  await fs.copyFile(path.join(root, file), path.join(outputDir, file));
}
console.log(`发行目录：${outputDir}`);
