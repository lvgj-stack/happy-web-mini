// `npm start` runs this first: build-info.json says which commit is being
// served, for 设置 › 关于 (see version.js). The Mac app gets its own from
// desktop/build.mjs.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const git = (...args) => { try { return execFileSync('git', args, { cwd: here, encoding: 'utf8' }).trim(); } catch { return ''; } };
const version = JSON.parse(fs.readFileSync(path.join(here, '..', 'desktop', 'package.json'), 'utf8')).version;

const info = {
    source: 'web',
    version,
    commit: git('rev-parse', '--short', 'HEAD') || 'unknown',
    dirty: git('status', '--porcelain', '--untracked-files=no') !== '',
    builtAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(here, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`build-info.json: ${info.version} · ${info.commit}${info.dirty ? ' (uncommitted changes)' : ''}`);
