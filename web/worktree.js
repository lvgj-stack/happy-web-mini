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
 * One `bash` call does it all, each being a round trip through the server to the
 * daemon; a Windows daemon runs commands in cmd.exe, so there it takes one per step.
 */
export async function createWorktree(path, bash, random = Math.random, { windows = false } = {}) {
    const name = randomWorktreeName(random);
    if (windows) return createWorktreeStepwise(path, bash, name);
    const branches = [name, `${name}-2`, `${name}-3`, `${name}-4`].join(' ');
    // POSIX sh (the daemon runs it with exec): prints the repository and the branch it made.
    const script = [
        'top=$(git rev-parse --show-toplevel) || exit 1',
        `base=\${top%%${WORKTREE_MARKER}*}`, // repoOf()
        'cd "$base" || exit 1',
        `for b in ${branches}; do`,
        `  if out=$(git worktree add -b "$b" "${WORKTREE_DIR}/$b" 2>&1); then printf '%s\\n%s\\n' "$base" "$b"; exit 0; fi`,
        '  case $out in *"already exists"*) ;; *) break ;; esac',
        'done',
        `printf '%s\\n' "$out" >&2`,
        'exit 1',
    ].join('\n');
    const r = await bash(script, repoOf(path));
    const [base, branch] = r.stdout.trim().split('\n');
    if (r.success && base && branch) return { path: `${base}/${WORKTREE_DIR}/${branch}`, branch };
    const why = `${r.stderr}`.trim();
    if (/not a git repository/i.test(why)) throw new Error('这个目录不是 git 仓库');
    throw new Error(why || '建 worktree 失败');
}

async function createWorktreeStepwise(path, bash, name) {
    const top = await bash('git rev-parse --show-toplevel', repoOf(path));
    if (!top.success) {
        const why = `${top.stderr}`.trim();
        throw new Error(!why || /not a git repository/i.test(why) ? '这个目录不是 git 仓库' : why);
    }
    const base = repoOf(top.stdout.trim());
    let r;
    for (const branch of [name, `${name}-2`, `${name}-3`, `${name}-4`]) {
        r = await bash(`git worktree add -b ${branch} ${WORKTREE_DIR}/${branch}`, base);
        if (r.success) return { path: `${base}/${WORKTREE_DIR}/${branch}`, branch };
        if (!/already exists/.test(r.stderr)) break;
    }
    throw new Error(`${r.stderr}`.trim() || '建 worktree 失败');
}

/** The worktree checkout a path is in (`<repo>/.dev/worktree/<name>`), or null for any other path. */
export function worktreeOf(path) {
    const at = path.indexOf(WORKTREE_MARKER);
    if (at < 0) return null;
    const name = path.slice(at + WORKTREE_MARKER.length).split('/')[0];
    return name ? path.slice(0, at + WORKTREE_MARKER.length) + name : null;
}

const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * Remove a worktree and, when it is merged, its branch (`git branch -d`; an
 * unmerged one is kept). Resolves to { branch, branchDeleted, branchError }.
 * Without `force`, a checkout with changes is left alone: the error then has `dirty: true`.
 */
export async function removeWorktree(path, bash, { force = false } = {}) {
    const base = repoOf(path);
    const current = await bash('git branch --show-current', path); // empty when detached
    const branch = (current.success && current.stdout.trim()) || null;
    const r = await bash(`git worktree remove ${force ? '--force ' : ''}${quote(path)}`, base);
    if (!r.success) {
        const why = `${r.stderr}`.trim();
        const error = new Error(why || '删除 worktree 失败');
        error.dirty = /modified or untracked files/.test(why);
        throw error;
    }
    if (!branch) return { branch: null, branchDeleted: false, branchError: '' };
    const b = await bash(`git branch -d ${quote(branch)}`, base);
    return { branch, branchDeleted: b.success, branchError: b.success ? '' : `${b.stderr}`.trim() };
}
