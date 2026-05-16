/**
 * Bundle the extension with esbuild and copy static assets into dist/.
 * Output is loadable as an unpacked Chrome extension at packages/extension/dist.
 */

import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { build, type BuildOptions } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, 'src');
const OUT = join(here, 'dist');

const COMMON: BuildOptions = {
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  platform: 'browser',
  sourcemap: true,
  logLevel: 'info',
};

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  await build({
    ...COMMON,
    entryPoints: [join(SRC, 'background.ts')],
    outfile: join(OUT, 'background.js'),
  });

  await build({
    ...COMMON,
    entryPoints: [join(SRC, 'sidepanel/sidepanel.ts')],
    outfile: join(OUT, 'sidepanel.js'),
  });

  await build({
    ...COMMON,
    entryPoints: [join(SRC, 'options/options.ts')],
    outfile: join(OUT, 'options.js'),
  });

  copyFileSync(join(here, 'manifest.json'), join(OUT, 'manifest.json'));
  copyFileSync(
    join(SRC, 'sidepanel/sidepanel.html'),
    join(OUT, 'sidepanel.html'),
  );
  copyFileSync(
    join(SRC, 'sidepanel/sidepanel.css'),
    join(OUT, 'sidepanel.css'),
  );
  copyFileSync(join(SRC, 'options/options.html'), join(OUT, 'options.html'));
  copyFileSync(join(SRC, 'options/options.css'), join(OUT, 'options.css'));

  console.log(`✔ extension bundled at ${OUT}`);
}

void main();
