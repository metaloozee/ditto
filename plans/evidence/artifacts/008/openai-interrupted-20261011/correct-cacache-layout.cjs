const fs = require('node:fs');
const path = require('node:path');
const req = require('node:module').createRequire('/home/ayan/.vite-plus/js_runtime/node/24.21.0/lib/node_modules/npm/package.json');
const cacache = req('cacache');
const pacote = req('pacote');
const root = path.join(process.cwd(), '.execution-008/home/.npm');
const target = path.join(root, '_cacache');
(async () => {
 const entries = await cacache.ls(root);
 let copied = 0;
 for (const entry of Object.values(entries)) {
  const prefixes = ['make-fetch-happen:request-cache:', 'pacote:tarball:'];
  const prefix = prefixes.find(prefix => entry.key.startsWith(prefix));
  if (!prefix) throw Error('Unexpected cache key');
  const url = new URL(entry.key.slice(prefix.length));
  if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password) throw Error('Nonpublic destination');
  const item = await cacache.get(root, entry.key);
  await cacache.put(target, entry.key, item.data, { metadata: item.metadata, integrity: item.integrity });
  copied++;
 }
 const manifest = await pacote.manifest('vitest@^3.2.0', {cache: target, registry: 'https://registry.npmjs.org', fullMetadata: true, offline: true, ignoreScripts: true});
 console.log(JSON.stringify({copied, offlineVitest: manifest.version}));
 fs.writeFileSync(path.join(__dirname, 'cacache-layout.json'), JSON.stringify({copied, offlineVitest: manifest.version}, null, 2) + '\n');
})().catch(error => {console.error(error); process.exitCode = 1;});
