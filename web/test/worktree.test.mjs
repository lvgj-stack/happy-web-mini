// node --test: worktree.js against a real git repository, with `bash` run locally.
import assert from 'node:assert/strict';
import { exec } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createWorktree, listWorktrees, parseWorktreeList, randomWorktreeName, removeWorktree, repoOf, worktreeOf } from '../worktree.js';

/** The daemon's `bash` RPC, locally: same result shape. */
const bash = (command, cwd) => new Promise((resolve) => {
    exec(command, { cwd }, (error, stdout, stderr) => resolve({ success: !error, stdout, stderr, exitCode: error ? error.code ?? 1 : 0 }));
});

const root = realpathSync(mkdtempSync(join(tmpdir(), 'happy-worktree-')));
after(() => rmSync(root, { recursive: true, force: true }));
const repo = join(root, 'repo');
mkdirSync(join(repo, 'sub'), { recursive: true });
await bash('git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', repo);

const fixed = (x) => () => x; // a random() that always picks the same words

test('names are adjective-noun', () => {
    assert.match(randomWorktreeName(), /^[a-z]+-[a-z]+$/);
    assert.equal(randomWorktreeName(fixed(0)), 'clever-ocean');
});

test('repoOf: a worktree path counts as its main checkout', () => {
    assert.equal(repoOf('/a/repo/.dev/worktree/x/sub'), '/a/repo');
    assert.equal(repoOf('/a/repo'), '/a/repo');
});

test('parseWorktreeList leaves out the main checkout; a detached one goes by its folder', () => {
    const out = 'worktree /r\nHEAD 1\nbranch refs/heads/main\n\nworktree /r/.dev/worktree/a\nHEAD 2\nbranch refs/heads/feat/a\n\nworktree /r/.dev/worktree/b\nHEAD 3\ndetached\n';
    assert.deepEqual(parseWorktreeList(out), [{ path: '/r/.dev/worktree/a', branch: 'feat/a' }, { path: '/r/.dev/worktree/b', branch: 'b' }]);
});

test('creates under the repository top level, from a subdirectory too, and lists it', async () => {
    assert.deepEqual(await listWorktrees(repo, bash), []);
    const made = await createWorktree(join(repo, 'sub'), bash, fixed(0));
    assert.deepEqual(made, { path: `${repo}/.dev/worktree/clever-ocean`, branch: 'clever-ocean' });
    assert.equal((await bash('git branch --show-current', made.path)).stdout.trim(), 'clever-ocean');
    assert.deepEqual(await listWorktrees(repo, bash), [made]);
    assert.deepEqual(await listWorktrees(made.path, bash), [made], 'listed from inside a worktree too');
});

test('a taken name gets -2; started from inside a worktree it still lands in the repository', async () => {
    const made = await createWorktree(`${repo}/.dev/worktree/clever-ocean`, bash, fixed(0));
    assert.deepEqual(made, { path: `${repo}/.dev/worktree/clever-ocean-2`, branch: 'clever-ocean-2' });
});

test('one bash call per worktree (each is a round trip to the daemon), under bash as sh too (macOS)', async () => {
    const calls = [];
    const asBash = (command, cwd) => new Promise((resolve) => {
        calls.push(command);
        exec(command, { cwd, shell: 'bash' }, (error, stdout, stderr) => resolve({ success: !error, stdout, stderr, exitCode: error ? error.code ?? 1 : 0 }));
    });
    const made = await createWorktree(join(repo, 'sub'), asBash, fixed(0.99));
    assert.deepEqual(made, { path: `${repo}/.dev/worktree/fresh-desert`, branch: 'fresh-desert' });
    assert.equal(calls.length, 1);
});

test('all four names taken, or git failing otherwise: git says why', async () => {
    for (const b of ['bold-mountain-2', 'bold-mountain-3', 'bold-mountain-4']) await bash(`git branch ${b}`, repo);
    assert.equal((await createWorktree(repo, bash, fixed(0.34))).branch, 'bold-mountain');
    await assert.rejects(createWorktree(repo, bash, fixed(0.34)), /already exists/);
    const broken = async (command, cwd) => bash(command.replace('git worktree add', 'git worktree add --no-such-flag'), cwd);
    await assert.rejects(createWorktree(repo, broken, fixed(0.8)), /no-such-flag|unknown option/);
});

test('a Windows daemon (cmd.exe) gets one plain git command per step', async () => {
    const calls = [];
    const logged = (command, cwd) => { calls.push(command); return bash(command, cwd); };
    const made = await createWorktree(join(repo, 'sub'), logged, fixed(0.99), { windows: true });
    assert.deepEqual(made, { path: `${repo}/.dev/worktree/fresh-desert-2`, branch: 'fresh-desert-2' });
    assert.deepEqual(calls, ['git rev-parse --show-toplevel', 'git worktree add -b fresh-desert .dev/worktree/fresh-desert',
        'git worktree add -b fresh-desert-2 .dev/worktree/fresh-desert-2']);
    const plain = join(root, 'plain-win');
    mkdirSync(plain);
    await assert.rejects(createWorktree(plain, bash, Math.random, { windows: true }), { message: '这个目录不是 git 仓库' });
});

test('not a git repository: null list, a plain error on create', async () => {
    const plain = join(root, 'plain');
    mkdirSync(plain);
    assert.equal(await listWorktrees(plain, bash), null);
    await assert.rejects(createWorktree(plain, bash), { message: '这个目录不是 git 仓库' });
});

test('the daemon cannot be reached: its words come through', async () => {
    const down = async () => ({ success: false, stdout: '', stderr: '这台电脑的 daemon 没有响应', exitCode: -1 });
    assert.equal(await listWorktrees(repo, down), null);
    await assert.rejects(createWorktree(repo, down), { message: '这台电脑的 daemon 没有响应' });
});

test('worktreeOf: the checkout a path is in', () => {
    assert.equal(worktreeOf('/a/repo/.dev/worktree/x/sub/dir'), '/a/repo/.dev/worktree/x');
    assert.equal(worktreeOf('/a/repo/.dev/worktree/x'), '/a/repo/.dev/worktree/x');
    assert.equal(worktreeOf('/a/repo/sub'), null);
    assert.equal(worktreeOf('/a/repo/.dev/worktree/'), null);
});

const git = (args, cwd) => bash(`git -c user.email=t@t -c user.name=t ${args}`, cwd);

test('removes a clean worktree and its merged branch', async () => {
    const made = await createWorktree(repo, bash, fixed(0.5));
    assert.deepEqual(await removeWorktree(made.path, bash), { branch: made.branch, branchDeleted: true, branchError: '' });
    assert.ok(!existsSync(made.path));
    assert.equal((await bash(`git branch --list ${made.branch}`, repo)).stdout.trim(), '');
});

test('an unmerged branch is kept', async () => {
    const made = await createWorktree(repo, bash, fixed(0.6));
    await git('commit -q --allow-empty -m work', made.path);
    const r = await removeWorktree(made.path, bash);
    assert.equal(r.branchDeleted, false);
    assert.match(r.branchError, /not fully merged/);
    assert.ok(!existsSync(made.path));
    assert.equal((await bash(`git branch --list ${made.branch}`, repo)).stdout.trim(), made.branch);
});

test('changes in it: refused as dirty unless forced', async () => {
    const made = await createWorktree(repo, bash, fixed(0.7));
    writeFileSync(join(made.path, 'new.txt'), 'x');
    await assert.rejects(removeWorktree(made.path, bash), { dirty: true });
    assert.ok(existsSync(made.path));
    assert.equal((await removeWorktree(made.path, bash, { force: true })).branchDeleted, true);
    assert.ok(!existsSync(made.path));
});

test('a detached worktree: no branch is touched', async () => {
    const path = `${repo}/.dev/worktree/loose`;
    await bash(`git worktree add --detach ${path}`, repo);
    await bash('git branch loose', repo); // same name as the folder, must survive
    assert.deepEqual(await removeWorktree(path, bash), { branch: null, branchDeleted: false, branchError: '' });
    assert.equal((await bash('git branch --list loose', repo)).stdout.trim(), 'loose');
});
