// Builds the published site:  node web/build.mjs [output folder]
//
// Copies the page and adds 404.html, which GitHub Pages serves for every
// unknown path. That makes  <site>/sjonvarp/spila/show/123/abc  open the
// episode directly. 404.html needs root-absolute script paths: '/' on a
// custom domain (web/CNAME exists), '/ruv-dl/' on thrkll.github.io/ruv-dl.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] || path.join(here, '..', '_site'));
const hasCname = fs.existsSync(path.join(here, 'CNAME'));
const base = process.env.BASE_PATH || (hasCname ? '/' : '/ruv-dl/');

fs.mkdirSync(out, { recursive: true });
for (const file of ['index.html', 'app.js', 'ruvdl.js', ...(hasCname ? ['CNAME'] : [])]) {
  fs.copyFileSync(path.join(here, file), path.join(out, file));
}

const index = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const notFound = index.replace('src="app.js"', `src="${base}app.js"`);
if (notFound === index) throw new Error('index.html: app.js script tag not found');
fs.writeFileSync(path.join(out, '404.html'), notFound);

console.log(`Built ${out} (base path ${base})`);
