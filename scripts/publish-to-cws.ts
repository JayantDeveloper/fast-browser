#!/usr/bin/env tsx
/**
 * Push a new version of fast-browser to the Chrome Web Store via the
 * Publish API. Listing metadata (name, screenshots, etc.) is not API-
 * settable — this script only uploads a new zip and publishes the
 * resulting draft. All metadata you set up at first-submission time
 * persists through subsequent uploads.
 *
 * Required env (in project-root .env):
 *   CWS_CLIENT_ID      — Google Cloud OAuth client ID
 *   CWS_CLIENT_SECRET  — same client's secret
 *   CWS_REFRESH_TOKEN  — refresh token from one-time consent flow
 *   CWS_EXTENSION_ID   — the 32-char appId Google gives the listing
 *
 * Usage:
 *   pnpm publish:cws                     # upload + publish current production build
 *   pnpm publish:cws --upload-only       # just upload, don't publish yet
 *   pnpm publish:cws --dry-run           # auth + status check, no upload
 *
 * Builds with PRODUCTION=1 automatically before uploading.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..');
const EXT_DIR = join(REPO_ROOT, 'packages', 'extension');
const ENV_FILE = join(REPO_ROOT, '.env');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL_BASE = 'https://www.googleapis.com/upload/chromewebstore/v1.1/items';
const PUBLISH_URL_BASE = 'https://www.googleapis.com/chromewebstore/v1.1/items';

interface Env {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  extensionId: string;
}

interface UploadResponse {
  kind: string;
  id: string;
  uploadState: 'SUCCESS' | 'FAILURE' | 'IN_PROGRESS' | 'NOT_FOUND';
  itemError?: Array<{ error_code: string; error_detail: string }>;
}

interface PublishResponse {
  kind: string;
  item_id: string;
  status: string[];
  statusDetail: string[];
}

function loadEnv(): Env {
  if (!existsSync(ENV_FILE)) {
    fatal(`No .env at ${ENV_FILE}. See docs/runbooks/cws-publish-setup.md.`);
  }
  const lines = readFileSync(ENV_FILE, 'utf8').split('\n');
  const map: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (k && v) map[k] = v;
  }
  const required = [
    'CWS_CLIENT_ID',
    'CWS_CLIENT_SECRET',
    'CWS_REFRESH_TOKEN',
    'CWS_EXTENSION_ID',
  ] as const;
  for (const key of required) {
    if (!map[key]) {
      fatal(`Missing ${key} in ${ENV_FILE}. See docs/runbooks/cws-publish-setup.md.`);
    }
  }
  return {
    clientId: map['CWS_CLIENT_ID']!,
    clientSecret: map['CWS_CLIENT_SECRET']!,
    refreshToken: map['CWS_REFRESH_TOKEN']!,
    extensionId: map['CWS_EXTENSION_ID']!,
  };
}

async function exchangeRefreshToken(env: Env): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    refresh_token: env.refreshToken,
    grant_type: 'refresh_token',
  });
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    fatal(`Token exchange failed (${resp.status}): ${await resp.text()}`);
  }
  const json = (await resp.json()) as { access_token: string };
  return json.access_token;
}

function buildProductionZip(): string {
  console.log('▸ Building production zip…');
  execSync('PRODUCTION=1 pnpm exec tsx build.ts', {
    cwd: EXT_DIR,
    stdio: 'inherit',
  });
  const pkgPath = join(EXT_DIR, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  const zipPath = join(REPO_ROOT, 'store', `fast-browser-${pkg.version}.zip`);
  execSync(`rm -f "${zipPath}"`, { stdio: 'inherit' });
  execSync(`cd "${EXT_DIR}" && zip -qr "${zipPath}" dist/ -x '*.map'`, {
    stdio: 'inherit',
  });
  console.log(`▸ Built ${zipPath}`);
  return zipPath;
}

async function uploadZip(
  env: Env,
  accessToken: string,
  zipPath: string,
): Promise<UploadResponse> {
  const zipBytes = readFileSync(zipPath);
  const url = `${UPLOAD_URL_BASE}/${env.extensionId}`;
  console.log(`▸ Uploading ${zipPath} → ${env.extensionId}…`);
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-goog-api-version': '2',
    },
    body: zipBytes as unknown as BodyInit,
  });
  if (!resp.ok) {
    fatal(`Upload failed (${resp.status}): ${await resp.text()}`);
  }
  const json = (await resp.json()) as UploadResponse;
  if (json.uploadState !== 'SUCCESS') {
    const detail = json.itemError?.map((e) => `${e.error_code}: ${e.error_detail}`).join('\n');
    fatal(`Upload uploadState=${json.uploadState}\n${detail}`);
  }
  console.log(`▸ Uploaded successfully (item ${json.id})`);
  return json;
}

async function publishItem(
  env: Env,
  accessToken: string,
): Promise<PublishResponse> {
  const url = `${PUBLISH_URL_BASE}/${env.extensionId}/publish`;
  console.log(`▸ Publishing ${env.extensionId}…`);
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-goog-api-version': '2',
      'content-length': '0',
    },
  });
  if (!resp.ok) {
    fatal(`Publish failed (${resp.status}): ${await resp.text()}`);
  }
  const json = (await resp.json()) as PublishResponse;
  console.log(`▸ Publish status: ${json.status.join(', ')}`);
  if (json.statusDetail.length > 0) {
    console.log(`  detail: ${json.statusDetail.join('\n  ')}`);
  }
  return json;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const uploadOnly = args.has('--upload-only');
  const dryRun = args.has('--dry-run');

  const env = loadEnv();
  const accessToken = await exchangeRefreshToken(env);
  console.log('▸ Authenticated.');

  if (dryRun) {
    console.log('▸ Dry run — exiting before upload.');
    return;
  }

  const zipPath = buildProductionZip();
  await uploadZip(env, accessToken, zipPath);

  if (uploadOnly) {
    console.log('▸ --upload-only set; not publishing. Visit the dev console to review and publish manually.');
    return;
  }

  await publishItem(env, accessToken);
  console.log('▸ Done. Update goes live within a few hours (longer on first-version review).');
}

function fatal(msg: string): never {
  process.stderr.write(`✗ ${msg}\n`);
  process.exit(1);
}

void main().catch((e: unknown) => {
  fatal((e as Error).stack ?? String(e));
});
