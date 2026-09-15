// Copies the README and LICENSE from the repo root into the library project
// before `ng build ngx-transformers`, so the npm package ships the same files
// GitHub shows. ng-packagr only picks up assets from inside the project root,
// and the copies are gitignored so the root files stay the single source.
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = join(root, 'projects', 'ngx-transformers');

for (const file of ['README.md', 'LICENSE']) {
  copyFileSync(join(root, file), join(lib, file));
  console.log(`synced ${file} -> projects/ngx-transformers/${file}`);
}
