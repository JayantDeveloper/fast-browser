/**
 * Bundle the extension with esbuild and copy static assets into dist/.
 * Output is loadable as an unpacked Chrome extension at packages/extension/dist.
 */

import {
  copyFileSync,
  existsSync,
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
/**
 * SHARE mode: like PRODUCTION (minified, no sourcemaps, no test hook)
 * but KEEPS the .env API keys baked in. Use this to send a self-contained
 * extension to a single trusted recipient who shouldn't have to configure
 * anything. Never publish a SHARE build — the recipient's key is in it.
 */
const SHARE = process.env['SHARE'] === '1';

const STRIP_TEST_HOOK = PRODUCTION || SHARE;
const STRIP_KEYS = PRODUCTION;
const MINIFY = PRODUCTION || SHARE;
const SOURCEMAPS = !PRODUCTION && !SHARE;

/**
 * Read API keys from the project-root .env for dev / SHARE builds so the
 * extension auto-populates the Options form on first launch. Returns
 * {} in production. Builds that keep keys (dev / SHARE) bake them
 * directly into the bundle — do NOT distribute those broadly.
 */
function readDevKeys(): Record<string, string> {
  if (STRIP_KEYS) {
    return {};
  }
  const envPath = join(here, '..', '..', '.env');
  if (!existsSync(envPath)) {
    return {};
  }
  const fieldMap: Record<string, string> = {
    ANTHROPIC_API_KEY: 'anthropic',
    GEMINI_API_KEY: 'gemini',
    OPENROUTER_API_KEY: 'openrouter',
  };
  const out: Record<string, string> = {};
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    const settingsField = fieldMap[key];
    if (settingsField && value) {
      out[settingsField] = value;
    }
  }
  return out;
}

const DEV_KEYS = readDevKeys();

const COMMON: BuildOptions = {
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  platform: 'browser',
  sourcemap: SOURCEMAPS,
  minify: MINIFY,
  logLevel: 'info',
  define: {
    __FB_TEST_HOOK__: STRIP_TEST_HOOK ? 'false' : 'true',
    __FB_DEV_KEYS__: JSON.stringify(DEV_KEYS),
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
    verifyProductionClean([
      join(OUT, 'background.js'),
      join(OUT, 'options.js'),
      join(OUT, 'sidepanel.js'),
    ]);
  } else if (Object.keys(DEV_KEYS).length > 0) {
    const label = SHARE ? 'baked into SHARE build' : 'baked from .env';
    console.log(`  keys ${label}: ${Object.keys(DEV_KEYS).join(', ')}`);
  }

  if (SHARE) {
    verifyTestHookStripped([
      join(OUT, 'background.js'),
      join(OUT, 'options.js'),
      join(OUT, 'sidepanel.js'),
    ]);
  }

  const mode = PRODUCTION ? 'production' : SHARE ? 'SHARE' : 'dev';
  console.log(`✔ extension bundled at ${OUT} (${mode})`);
}

/** Sanity-check that a SHARE build has no test hook (keys are expected). */
function verifyTestHookStripped(files: string[]): void {
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (src.includes('__fb_test')) {
      throw new Error(
        `SHARE build leaked __fb_test into ${file}. ` +
          `Check that __FB_TEST_HOOK__ define resolved to 'false'.`,
      );
    }
  }
  console.log(`  verified SHARE bundle has no test hook`);
}

/**
 * Sanity-check that the production bundle has no test hook AND no
 * baked API key material. Failing the build here is much cheaper than
 * discovering a leaked key in the Web Store zip.
 */
function verifyProductionClean(files: string[]): void {
  const secretPrefixes = ['sk-ant-', 'sk-or-', 'AIzaSy'];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (src.includes('__fb_test')) {
      throw new Error(
        `production build leaked __fb_test into ${file}. ` +
          `Check that __FB_TEST_HOOK__ is 'false' in COMMON.define.`,
      );
    }
    for (const prefix of secretPrefixes) {
      if (src.includes(prefix)) {
        throw new Error(
          `production build leaked an API key (matched "${prefix}") ` +
            `into ${file}. Check that __FB_DEV_KEYS__ is "{}" when ` +
            `PRODUCTION=1.`,
        );
      }
    }
  }
  console.log(`  verified production bundle has no test hook or baked keys`);
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
