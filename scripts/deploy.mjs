// Uploads dist/ to the live site over WebDAV (cPanel "Web Disk"), replacing the
// manual zip-and-extract in File Manager. This host has FTP disabled, so Web Disk
// is the available equivalent.
//
//   npm run deploy           build, then upload
//   npm run deploy:dry       connect and list what would happen, change nothing
//
// Credentials go in .env.local (gitignored) — never hard-code them here:
//
//   WEBDAV_URL=https://your-domain.example:2078
//   WEBDAV_USER=you@your-domain.example
//   WEBDAV_PASSWORD=...
//   WEBDAV_REMOTE_DIR=/            (relative to the Web Disk account's root)
//
// Set WEBDAV_INSECURE=1 only if the server presents a certificate for a
// different hostname, which shared hosts often do on port 2078.
//
// Uses node:https directly rather than a WebDAV library: the protocol needed
// here is just PUT, MKCOL, PROPFIND and DELETE, and this keeps the dependency
// count at zero while allowing per-request TLS control.

import { request } from 'node:https';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, posix } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry');

function loadEnv() {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };
const baseUrl = env.WEBDAV_URL;
const user = env.WEBDAV_USER;
const password = env.WEBDAV_PASSWORD;
const remoteDir = env.WEBDAV_REMOTE_DIR || '/';
const insecure = env.WEBDAV_INSECURE === '1';

if (!baseUrl || !user || !password) {
  console.error(
    'Missing Web Disk settings. Add these to .env.local:\n\n' +
    '  WEBDAV_URL=https://your-domain.example:2078\n' +
    '  WEBDAV_USER=you@your-domain.example\n' +
    '  WEBDAV_PASSWORD=...\n' +
    '  WEBDAV_REMOTE_DIR=/\n\n' +
    'Create the account in cPanel under Files -> Web Disk.',
  );
  process.exit(1);
}

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('No dist/index.html — run `npm run build` first.');
  process.exit(1);
}

const url = new URL(baseUrl);
const auth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

function dav(method, remotePath, body) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: encodeURI(posix.join(url.pathname || '/', remotePath)),
        method,
        rejectUnauthorized: !insecure,
        headers: {
          Authorization: auth,
          ...(body ? { 'Content-Length': body.length } : {}),
          ...(method === 'PROPFIND' ? { Depth: '1' } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Every file under dist/, as paths relative to dist/. */
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(relative(join(root, 'dist'), full).split('\\').join('/'));
  }
  return acc;
}

const files = walk(join(root, 'dist'));
const remoteBase = remoteDir.endsWith('/') ? remoteDir : remoteDir + '/';

console.log(`Web Disk: ${url.host}${url.pathname}`);
console.log(`Target:   ${remoteBase}`);
console.log(`Files:    ${files.length}\n`);

try {
  const probe = await dav('PROPFIND', remoteBase);
  if (probe.status === 401) {
    console.error('Authentication failed (401). Check WEBDAV_USER and WEBDAV_PASSWORD.');
    console.error('The username is usually the full account, e.g. you@your-domain.example');
    process.exit(1);
  }
  if (probe.status >= 400 && probe.status !== 404) {
    console.error(`Server said ${probe.status} for ${remoteBase}. Check WEBDAV_REMOTE_DIR.`);
    process.exit(1);
  }
  console.log(`Connected (PROPFIND ${probe.status}).`);

  if (dryRun) {
    console.log('\nDry run — nothing uploaded. Would send:');
    for (const f of files) console.log('  ' + remoteBase + f);
    process.exit(0);
  }

  // Create directories first; MKCOL on an existing collection returns 405, which is fine.
  const dirs = [...new Set(files.map((f) => posix.dirname(f)).filter((d) => d !== '.'))];
  for (const d of dirs) {
    const res = await dav('MKCOL', remoteBase + d);
    if (res.status >= 400 && res.status !== 405) {
      console.warn(`  ! MKCOL ${d} -> ${res.status}`);
    }
  }

  let done = 0;
  for (const f of files) {
    const body = readFileSync(join(root, 'dist', f));
    const res = await dav('PUT', remoteBase + f, body);
    if (res.status >= 400) {
      console.error(`  x ${f} -> ${res.status}`);
    } else {
      done++;
      process.stdout.write(`  ${done}/${files.length} ${f}\r`);
    }
  }

  console.log(`\n\nUploaded ${done}/${files.length} files.`);
  console.log('Live: https://nbparagliding.nz/vtasker/');
  if (done < files.length) process.exitCode = 1;
} catch (err) {
  console.error('\nDeploy failed:', err.message);
  if (/certificate/i.test(err.message)) {
    console.error('TLS problem — shared hosts often serve port 2078 with a mismatched');
    console.error('certificate. Add WEBDAV_INSECURE=1 to .env.local to skip verification.');
  }
  process.exitCode = 1;
}
