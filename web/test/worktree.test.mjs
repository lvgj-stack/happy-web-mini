// node --test: worktree.js against a real git repository, with `bash` run locally.
import assert from 'node:assert/strict';
import { exec } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createWorktree, listWorktrees, parseWorktreeList, randomWorktreeName, repoOf } from '../worktree.js';

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
