// Git worktrees for 新建会话, the way the official apps make them
// (utils/worktree.ts): a new `adjective-noun` branch checked out under
// `.dev/worktree/` of the repository, through the daemon's `bash` RPC.
// `bash(command, cwd)` resolves to { success, stdout, stderr, exitCode }.

export const WORKTREE_DIR = '.dev/worktree';
export const WORKTREE_MARKER = `/${WORKTREE_DIR}/`;

const ADJECTIVES = ['clever', 'happy', 'swift', 'bright', 'calm', 'bold', 'quiet', 'brave', 'wise', 'eager',
    'gentle', 'quick', 'sharp', 'smooth', 'fresh'];
const NOUNS = ['ocean', 'forest', 'cloud', 'star', 'river', 'mountain', 'valley', 'bridge', 'beacon', 'harbor',
    'garden', 'meadow', 'canyon', 'island', 'desert'];

const pick = (list, random) => list[Math.floor(random() * list.length) % list.length];

export function randomWorktreeName(random = Math.random) {
    return `${pick(ADJECTIVES, random)}-${pick(NOUNS, random)}`;
}

/** The repository a path belongs to: a `.dev/worktree/*` path counts as its main checkout. */
export function repoOf(path) {
    const at = path.indexOf(WORKTREE_MARKER);
    return at >= 0 ? path.slice(0, at) : path;
}

/** `git worktree list --porcelain`, the main checkout left out: [{ path, branch }]. */
export function parseWorktreeList(stdout) {
    return stdout.trim().split(/\n\s*\n/).slice(1).map((block) => {
        let path = '';
        let branch = '';
        for (const line of block.split('\n')) {
            if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
            else if (line.startsWith('branch refs/heads/')) branch = line.slice('branch refs/heads/'.length);
        }
        return path ? { path, branch: branch || path.split('/').filter(Boolean).pop() } : null;
    }).filter(Boolean);
}

/** The repository's other checkouts, or null when the path is not in a git repository (or can't be reached). */
export async function listWorktrees(path, bash) {
    const r = await bash('git worktree list --porcelain', repoOf(path));
    return r.success ? parseWorktreeList(r.stdout) : null;
}

/**
 * Make a new worktree for the repository `path` is in; resolves to { path, branch }.
 * Created at the repository's top level, so a subdirectory or another worktree
 * still lands in `<repo>/.dev/worktree/<name>`. A taken name is retried as `-2` to `-4`.
 */
export async function createWorktree(path, bash, random = Math.random) {
    const top = await bash('git rev-parse --show-toplevel', repoOf(path));
    if (!top.success) {
        const why = `${top.stderr}`.trim();
        throw new Error(!why || /not a git repository/i.test(why) ? '这个目录不是 git 仓库' : why);
    }
    const base = repoOf(top.stdout.trim());
    const name = randomWorktreeName(random);
    const add = (branch) => bash(`git worktree add -b ${branch} ${WORKTREE_DIR}/${branch}`, base);
    let r = await add(name);
    if (r.success) return { path: `${base}/${WORKTREE_DIR}/${name}`, branch: name };
    if (/already exists/.test(r.stderr)) {
        for (let n = 2; n <= 4; n++) {
            const branch = `${name}-${n}`;
            r = await add(branch);
            if (r.success) return { path: `${base}/${WORKTREE_DIR}/${branch}`, branch };
        }
    }
    throw new Error(`${r.stderr}`.trim() || '建 worktree 失败');
}
