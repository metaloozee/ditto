const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire('/home/ayan/.vite-plus/js_runtime/node/24.21.0/lib/node_modules/npm/package.json');
const pacote = req('pacote');
const packages = JSON.parse(fs.readFileSync(path.join(__dirname, 'cache-packages.json'), 'utf8'));
const options = { cache: path.join(process.cwd(), '.execution-008/home/.npm'), registry: 'https://registry.npmjs.org', fullMetadata: true, ignoreScripts: true, preferOffline: true, audit: false, fund: false };
(async () => {
 const records = [];
 for (const item of packages) {
  const manifest = await pacote.manifest(item.spec, options);
  const url = new URL(manifest._resolved);
  if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password) throw Error('Nonpublic destination');
  if (manifest.version !== item.version) throw Error('Resolution changed');
  records.push({spec: item.spec, version: manifest.version, fullMetadata: true});
  console.log(item.spec, manifest.version);
 }
 fs.writeFileSync(path.join(__dirname, 'full-metadata-packages.json'), JSON.stringify(records, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
