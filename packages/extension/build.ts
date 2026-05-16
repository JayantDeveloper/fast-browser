/**
 * Bundle the extension with esbuild and copy static assets into dist/.
 * Output is loadable as an unpacked Chrome extension at packages/extension/dist.
 */

import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { build, type BuildOptions } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, 'src');
const OUT = join(here, 'dist');

const PRODUCTION = process.env['PRODUCTION'] === '1';

const COMMON: BuildOptions = {
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  platform: 'browser',
  sourcemap: !PRODUCTION,
  minify: PRODUCTION,
  logLevel: 'info',
  define: {
    __FB_TEST_HOOK__: PRODUCTION ? 'false' : 'true',
  },
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

  copyIcons();

  if (PRODUCTION) {
    verifyTestHookAbsent(join(OUT, 'background.js'));
  }

  console.log(
    `✔ extension bundled at ${OUT}${PRODUCTION ? ' (production)' : ' (dev)'}`,
  );
}

/** Sanity-check that the production bundle truly has no test hook. */
function verifyTestHookAbsent(file: string): void {
  const src = readFileSync(file, 'utf8');
  if (src.includes('__fb_test')) {
    throw new Error(
      `production build leaked __fb_test into ${file}. ` +
        `Check that __FB_TEST_HOOK__ is 'false' in COMMON.define and that ` +
        `the SW source uses if (__FB_TEST_HOOK__) { ... }.`,
    );
  }
  console.log(`  verified ${file} has no test hook`);
}

function copyIcons(): void {
  const iconsSrc = join(here, 'icons');
  const iconsDest = join(OUT, 'icons');
  mkdirSync(iconsDest, { recursive: true });
  for (const file of readdirSync(iconsSrc)) {
    if (file.endsWith('.png')) {
      copyFileSync(join(iconsSrc, file), join(iconsDest, file));
    }
  }
}

void main();
