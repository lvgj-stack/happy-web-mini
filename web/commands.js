// Slash commands offered after "/", from the session's metadata.
// Mirrors iOS ComposerAutocomplete (getCommandsFromSession / searchCommands).

/** Terminal-only commands that make no sense from a remote client. */
const IGNORED = new Set([
    'add-dir', 'agents', 'config', 'statusline', 'bashes', 'settings', 'cost', 'doctor', 'exit', 'help', 'ide',
    'init', 'install-github-app', 'memory', 'migrate-installer', 'model', 'pr-comments', 'release-notes',
    'resume', 'status', 'bug', 'review', 'security-review', 'terminal-setup', 'upgrade', 'vim', 'permissions',
    'hooks', 'export', 'logout', 'login',
]);

const DEFAULTS = [
    ['compact', '压缩对话历史'],
    ['clear', '清空对话'],
    ['goal', '设定会话目标'],
    ['mcp', '查看已连接的 MCP 服务'],
    ['skills', '列出可用的 skills'],
];

const DESCRIPTIONS = {
    compact: '压缩对话历史', clear: '清空对话', goal: '设定会话目标',
    reset: '重置会话', stop: '停止当前操作', abort: '中止当前操作', cancel: '取消当前操作',
};

const strip = (name) => String(name).replace(/^\//, '');

/** [{ name, description, skill }]: the defaults, then slashCommands and skills, deduped. */
export function commandsFor(meta) {
    const list = DEFAULTS.map(([name, description]) => ({ name, description, skill: false }));
    const seen = new Set(list.map((c) => c.name));
    const skills = new Set((meta?.skills ?? []).map(strip));
    for (const raw of [...(meta?.slashCommands ?? []), ...(meta?.skills ?? [])]) {
        if (typeof raw !== 'string') continue;
        const name = strip(raw);
        if (!name || IGNORED.has(name) || seen.has(name)) continue;
        seen.add(name);
        list.push({ name, description: DESCRIPTIONS[name] ?? null, skill: skills.has(name) });
    }
    return list;
}

/**
 * Commands matching what follows the "/": name prefix first, then a word
 * inside the name (after - _ : /), then anywhere in name or description.
 */
export function searchCommands(query, meta, limit = Infinity) {
    const all = commandsFor(meta);
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, limit); // every command: the popup scrolls
    const rank = (c) => {
        const name = c.name.toLowerCase();
        if (name.startsWith(q)) return 0;
        if (name.split(/[-_:/]/).some((part) => part.startsWith(q))) return 1;
        if (name.includes(q)) return 2;
        if (c.description?.toLowerCase().includes(q)) return 3;
        return -1;
    };
    return all
        .map((c, i) => ({ c, i, r: rank(c) }))
        .filter((x) => x.r >= 0)
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .slice(0, limit)
        .map((x) => x.c);
}

/**
 * The "/word" the caret is in, or null. It must start the text or follow
 * whitespace, and the caret must be inside it (no space after the slash).
 */
export function activeSlash(text, caret) {
    let start = caret;
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    if (start >= caret || text[start] !== '/') return null;
    const word = text.slice(start, caret);
    if (word.slice(1).includes('/')) return null; // a path like /usr/bin, not a command
    let end = caret;
    while (end < text.length && !/\s/.test(text[end])) end++;
    return { start, end, query: word.slice(1) };
}

/** Text with the active word replaced by "/name ", and where the caret goes. */
export function applyCommand(text, word, name) {
    const after = text.slice(word.end);
    const insert = `/${name}` + (after.startsWith(' ') ? '' : ' ');
    return { text: text.slice(0, word.start) + insert + after, caret: word.start + insert.length };
}
