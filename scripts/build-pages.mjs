// Builds the docs site, the demo app and Storybook for GitHub Pages and
// assembles them in _site/: the docs at the root, the demo app under demo/
// and Storybook under storybook/. PAGES_BASE is the path the site is served
// from (default: /ngx-transformers/ for this repository).
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const base = (process.env.PAGES_BASE ?? '/ngx-transformers/').replace(/\/?$/, '/');
const site = resolve(root, '_site');
const run = (command, env = {}) => {
  console.log(`\n> ${command}`);
  execSync(command, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NG_CLI_ANALYTICS: 'false', ...env },
  });
};

// The same npm scripts CI runs, so the deployed site cannot drift from what CI checks.
run('npm run build:lib');
run('npm run docs:build', { PAGES_BASE: base });
run(`npm run build:demo -- --base-href ${base}demo/`);
run('npm run build-storybook', { CI: 'true' });

rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
cpSync(resolve(root, 'website/.vitepress/dist'), site, { recursive: true });
cpSync(resolve(root, 'dist/demo/browser'), resolve(site, 'demo'), { recursive: true });
cpSync(resolve(root, 'storybook-static'), resolve(site, 'storybook'), { recursive: true });
writeFileSync(resolve(site, '.nojekyll'), '');
console.log(`\nSite assembled in ${site} for base ${base}`);
