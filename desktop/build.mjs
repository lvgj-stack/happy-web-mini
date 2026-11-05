// Build Happy.app for macOS (arm64 and x64), from macOS or Linux.
//
//   npm run build                 # both architectures
//   npm run build -- --arch=arm64 # one
//
// 1. Stage: the shell (main.js, preload.js) plus the page under web/, with
//    only the node_modules files the page actually references (found by
//    following <link>/<script> and ES imports from index.html).
// 2. Icon: Happy.icns from assets/icon-*.png (the HappyMac app icon).
// 3. Package with @electron/packager for darwin.
// 4. Ad-hoc sign: codesign on a Mac, rcodesign elsewhere (if installed).
// 5. Zip with symlinks kept (the frameworks need them): dist/Happy-<v>-mac-<arch>.zip

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..', 'web');
const build = path.join(here, 'build');
const stage = path.join(build, 'stage');
const dist = path.join(here, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(fs.readFileSync(path.join(here, 'node_modules/electron/package.json'), 'utf8')).version;
const infoFile = path.join(dist, 'build-info.json');
const archArg = process.argv.find((a) => a.startsWith('--arch='));
const arches = archArg ? archArg.slice(7).split(',') : ['arm64', 'x64'];

// ---------- 1. Stage ----------

/** Every local file the page loads, starting from index.html. */
export function pageFiles(root) {
    const found = new Set();
    const queue = ['index.html'];
    const add = (from, ref) => {
        if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(ref)) return; // remote, data: or anchors
        const rel = path.posix.normalize(path.posix.join(path.posix.dirname(from), ref.split(/[?#]/)[0]));
        if (rel.startsWith('..')) throw new Error(`${from} reaches outside the page: ${ref}`);
        if (!found.has(rel)) queue.push(rel);
    };
    while (queue.length) {
        const rel = queue.shift();
        if (found.has(rel)) continue;
        const file = path.join(root, rel);
        if (!fs.existsSync(file)) throw new Error(`missing file the page needs: ${rel}`);
        found.add(rel);
        const text = fs.readFileSync(file, 'utf8');
        if (rel.endsWith('.html')) {
            for (const m of text.matchAll(/<(?:script|link|img)\b[^>]*?\s(?:src|href)="([^"]+)"/g)) add(rel, m[1]);
        } else if (/\.m?js$/.test(rel)) {
            for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)) add(rel, m[1]);
        } else if (rel.endsWith('.css')) {
            for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) add(rel, m[1]);
        }
    }
    return [...found].sort();
}

/** One hash over every page file and the shell, so a stale build can be told apart. */
function contentHash(files) {
    const h = createHash('sha256');
    for (const rel of files) h.update(rel + '\0').update(fs.readFileSync(path.join(webRoot, rel))).update('\0');
    for (const f of ['main.js', 'preload.js']) h.update(f + '\0').update(fs.readFileSync(path.join(here, f))).update('\0');
    return h.digest('hex').slice(0, 16);
}

function git(...args) {
    try { return execFileSync('git', args, { cwd: webRoot, encoding: 'utf8' }).trim(); } catch { return ''; }
}

function stageApp() {
    fs.rmSync(build, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    for (const f of ['main.js', 'preload.js']) fs.copyFileSync(path.join(here, f), path.join(stage, f));
    const { name, productName, version, description, main } = pkg;
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name, productName, version, description, main }, null, 2));
    const files = pageFiles(webRoot);
    for (const rel of files) {
        const to = path.join(stage, 'web', rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(webRoot, rel), to);
    }
    const info = {
        version: pkg.version,
        commit: git('rev-parse', '--short', 'HEAD') || 'unknown',
        dirty: git('status', '--porcelain', '--untracked-files=no') !== '',
        builtAt: new Date().toISOString(),
        hash: contentHash(files),
    };
    fs.writeFileSync(path.join(stage, 'build-info.json'), JSON.stringify(info, null, 2));
    console.log(`staged ${files.length} page files (${info.commit}${info.dirty ? ', uncommitted changes' : ''})`);
    return info;
}

/** `npm run check`: does dist/ hold a build of the page as it is now? */
function checkFresh() {
    let built;
    try { built = JSON.parse(fs.readFileSync(infoFile, 'utf8')); } catch {
        console.error('no build in dist/: run npm run build');
        return 1;
    }
    const now = contentHash(pageFiles(webRoot));
    if (built.hash !== now) {
        console.error(`dist/ is stale: built from ${built.commit} on ${built.builtAt}, the page has changed since. Run npm run build.`);
        return 1;
    }
    console.log(`dist/ is up to date (${built.commit}, ${built.builtAt})`);
    return 0;
}

// ---------- 2. Icon ----------

/** An .icns made of PNG entries (the format macOS 10.7+ reads). */
function writeIcns(to) {
    const entries = [ // [type, png size in px]
        ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512],
        ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
    ];
    const chunks = entries.map(([type, px]) => {
        const png = fs.readFileSync(path.join(here, 'assets', `icon-${px}.png`));
        const head = Buffer.alloc(8);
        head.write(type, 0, 'ascii');
        head.writeUInt32BE(png.length + 8, 4);
        return Buffer.concat([head, png]);
    });
    const head = Buffer.alloc(8);
    head.write('icns', 0, 'ascii');
    head.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4);
    fs.writeFileSync(to, Buffer.concat([head, ...chunks]));
}

// ---------- 4. Sign ----------

function has(cmd) {
    try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}

function adHocSign(appPath) {
    if (process.platform === 'darwin') {
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
        return 'codesign';
    }
    if (has('rcodesign')) {
        // No identity means an ad-hoc signature, sealing every nested bundle.
        // Electron's binaries come linker-signed without the hardened runtime,
        // so no JIT entitlements are needed.
        execFileSync('rcodesign', ['sign', appPath], { stdio: ['ignore', 'ignore', 'inherit'] });
        return 'rcodesign';
    }
    console.warn('warning: no codesign/rcodesign, the app is left unsigned (run `codesign --force --deep -s - Happy.app` on the Mac)');
    return null;
}

// ---------- Run ----------

async function main() {
    const info = stageApp();
    const icon = path.join(build, 'Happy.icns');
    writeIcns(icon);
    fs.mkdirSync(dist, { recursive: true });
    const apps = await packager({
        dir: stage,
        out: path.join(build, 'out'),
        name: 'Happy',
        platform: 'darwin',
        arch: arches,
        electronVersion,
        icon,
        asar: true,
        overwrite: true,
        prune: false,
        appBundleId: 'com.slopus.happy.webmini',
        appCategoryType: 'public.app-category.developer-tools',
        appCopyright: 'Happy web-mini',
        appVersion: pkg.version,
        darwinDarkModeSupport: false,
        extendInfo: { LSMinimumSystemVersion: '12.0', CFBundleDisplayName: 'Happy' },
    });
    for (const dir of apps) {
        const arch = dir.match(/darwin-(\w+)$/)[1];
        const appPath = path.join(dir, 'Happy.app');
        const signer = adHocSign(appPath);
        const zip = path.join(dist, `Happy-${pkg.version}-mac-${arch}.zip`);
        fs.rmSync(zip, { force: true });
        execFileSync('zip', ['-qry', zip, 'Happy.app'], { cwd: dir });
        const mb = (fs.statSync(zip).size / 1e6).toFixed(1);
        console.log(`${arch}: ${zip} (${mb} MB, ${signer ? `ad-hoc signed with ${signer}` : 'unsigned'})`);
    }
    fs.writeFileSync(infoFile, JSON.stringify(info, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    if (process.argv.includes('--check')) process.exit(checkFresh());
    main().catch((e) => { console.error(e); process.exit(1); });
}
