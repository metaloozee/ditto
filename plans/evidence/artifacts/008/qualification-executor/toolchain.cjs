const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const root = process.cwd();
const credential = createRequire(path.join(root, 'apps/credential-tests/vitest.config.ts'));
const runtime = createRequire(path.join(root, 'apps/runtime/vitest.config.ts'));
function pkg(request, id, entry = id) {
 let dir = path.dirname(request.resolve(entry));
 for (;;) {
  const file = path.join(dir, 'package.json');
  if (fs.existsSync(file)) {
   const value = JSON.parse(fs.readFileSync(file, 'utf8'));
   if (value.name === id) return { version: value.version, path: file };
  }
  const parent = path.dirname(dir);
  if (parent === dir) throw new Error('Package metadata not found: ' + id);
  dir = parent;
 }
}
const pool = pkg(credential, '@cloudflare/vitest-pool-workers', '@cloudflare/vitest-pool-workers/config');
const pr = createRequire(pool.path);
const miniflare = pkg(pr, 'miniflare');
const mr = createRequire(miniflare.path);
console.log(JSON.stringify({ node: process.version, vitest: pkg(credential, 'vitest'), pool, miniflare, workerd: pkg(mr, 'workerd'), workersTypes: JSON.parse(fs.readFileSync(path.join(root, 'apps/credential-tests/node_modules/@cloudflare/workers-types/package.json'), 'utf8')).version, runtime: pkg(runtime, '@earendil-works/pi-durable') }, null, 2));
