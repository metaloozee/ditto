const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire('/home/ayan/.vite-plus/js_runtime/node/24.21.0/lib/node_modules/npm/package.json');
const pacote = req('pacote');
const cacache = req('cacache');
const root = process.cwd();
const cache = path.join(root, '.execution-008/home/.npm');
const source = path.join(root, '.execution-008/cache/npm');
const options = { cache, registry: 'https://registry.npmjs.org', ignoreScripts: true, preferOffline: true, audit: false, fund: false };
const seen = new Set();
const records = [];
let sourceEntries;
function compatible(values, value) {
 if (!values) return true;
 return !values.includes(`!${value}`) && (!values.some(v => !v.startsWith('!')) || values.includes(value));
}
async function copyPublic(url) {
 for (const entry of Object.values(sourceEntries)) {
  if (entry.key !== `make-fetch-happen:request-cache:${url}` && entry.key !== `pacote:tarball:${url}`) continue;
  const item = await cacache.get(source, entry.key);
  await cacache.put(cache, entry.key, item.data, { metadata: item.metadata, integrity: item.integrity });
 }
}
async function visit(spec) {
 if (seen.has(spec)) return;
 seen.add(spec);
 const name = spec.slice(0, spec.lastIndexOf('@'));
 const metadataUrl = `https://registry.npmjs.org/${name.replace('/', '%2f')}`;
 await copyPublic(metadataUrl);
 const manifest = await pacote.manifest(spec, options);
 const resolved = new URL(manifest._resolved);
 if (resolved.origin !== 'https://registry.npmjs.org' || resolved.username || resolved.password) throw Error('Nonpublic destination');
 const installable = compatible(manifest.os, process.platform) && compatible(manifest.cpu, process.arch) && compatible(manifest.libc, 'glibc');
 console.log(spec, manifest.version, installable ? 'tarball' : 'metadata-only');
 records.push({ spec, version: manifest.version, resolved: manifest._resolved, integrity: manifest._integrity, installable });
 if (installable) {
  await copyPublic(manifest._resolved);
  await pacote.tarball.stream(manifest._resolved, stream => new Promise((resolve, reject) => { stream.on('error', reject); stream.on('end', resolve); stream.resume(); }), { ...options, integrity: manifest._integrity });
 }
 for (const [dep, range] of Object.entries({ ...manifest.dependencies, ...manifest.optionalDependencies })) await visit(`${dep}@${range}`);
}
(async () => {
 sourceEntries = await cacache.ls(source);
 await visit('vitest@^3.2.0');
 fs.writeFileSync(path.join(__dirname, 'cache-packages.json'), JSON.stringify(records, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
