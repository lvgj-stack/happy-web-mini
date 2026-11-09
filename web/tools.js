// How one tool call reads in the chat: an icon, a one-line summary (the
// command, the file, the pattern...) and the full detail behind a click.
// Tool names are Claude's (Bash, Read, Edit...) or Codex's (shell, apply_patch...).

// Icons come from Lucide (lucide-static): one SVG string per icon.
import SquareTerminal from './node_modules/lucide-static/dist/esm/icons/square-terminal.mjs';
import FileText from './node_modules/lucide-static/dist/esm/icons/file-text.mjs';
import Pencil from './node_modules/lucide-static/dist/esm/icons/pencil.mjs';
import Search from './node_modules/lucide-static/dist/esm/icons/search.mjs';
import Globe from './node_modules/lucide-static/dist/esm/icons/globe.mjs';
import Bot from './node_modules/lucide-static/dist/esm/icons/bot.mjs';
import ListTodo from './node_modules/lucide-static/dist/esm/icons/list-todo.mjs';
import CircleQuestionMark from './node_modules/lucide-static/dist/esm/icons/circle-question-mark.mjs';
import Wrench from './node_modules/lucide-static/dist/esm/icons/wrench.mjs';
import ImagePlus from './node_modules/lucide-static/dist/esm/icons/image-plus.mjs';
import Archive from './node_modules/lucide-static/dist/esm/icons/archive.mjs';
import ArrowUp from './node_modules/lucide-static/dist/esm/icons/arrow-up.mjs';
import Monitor from './node_modules/lucide-static/dist/esm/icons/monitor.mjs';
import Square from './node_modules/lucide-static/dist/esm/icons/square.mjs';
import LogOut from './node_modules/lucide-static/dist/esm/icons/log-out.mjs';
import ChevronLeft from './node_modules/lucide-static/dist/esm/icons/chevron-left.mjs';
import Plus from './node_modules/lucide-static/dist/esm/icons/plus.mjs';
import Circle from './node_modules/lucide-static/dist/esm/icons/circle.mjs';
import Settings from './node_modules/lucide-static/dist/esm/icons/settings.mjs';
import SquarePen from './node_modules/lucide-static/dist/esm/icons/square-pen.mjs';
import LoaderCircle from './node_modules/lucide-static/dist/esm/icons/loader-circle.mjs';
import MessageCircleQuestionMark from './node_modules/lucide-static/dist/esm/icons/message-circle-question-mark.mjs';
import PanelLeftClose from './node_modules/lucide-static/dist/esm/icons/panel-left-close.mjs';
import PanelLeftOpen from './node_modules/lucide-static/dist/esm/icons/panel-left-open.mjs';
import Copy from './node_modules/lucide-static/dist/esm/icons/copy.mjs';
import Check from './node_modules/lucide-static/dist/esm/icons/check.mjs';
import Folder from './node_modules/lucide-static/dist/esm/icons/folder.mjs';
import GitBranch from './node_modules/lucide-static/dist/esm/icons/git-branch.mjs';
import RotateCcw from './node_modules/lucide-static/dist/esm/icons/rotate-ccw.mjs';
import X from './node_modules/lucide-static/dist/esm/icons/x.mjs';

const ICONS = {
    terminal: SquareTerminal,
    file: FileText,
    edit: Pencil,
    search: Search,
    globe: Globe,
    agent: Bot,
    todo: ListTodo,
    ask: CircleQuestionMark,
    tool: Wrench,
    image: ImagePlus,
    archive: Archive,
    resume: RotateCcw,
    send: ArrowUp,
    computer: Monitor,
    stop: Square,
    logout: LogOut,
    back: ChevronLeft,
    plus: Plus,
    idle: Circle,
    unread: Circle,
    settings: Settings,
    newChat: SquarePen,
    working: LoaderCircle,
    waiting: MessageCircleQuestionMark,
    sideClose: PanelLeftClose,
    sideOpen: PanelLeftOpen,
    copy: Copy,
    copied: Check,
    folder: Folder,
    branch: GitBranch,
    close: X,
};

/** Filled icons: the glyph is a solid shape, not an outline. */
const FILLED = new Set(['stop', 'unread']);

/** An icon as inline SVG, sized by CSS (default 16px), decorative. */
export function iconSvg(name, size = 16) {
    let svg = (ICONS[name] ?? ICONS.tool).trim()
        .replace(/width="24"/, `width="${size}"`)
        .replace(/height="24"/, `height="${size}"`)
        .replace('<svg', '<svg aria-hidden="true" focusable="false"');
    if (FILLED.has(name)) svg = svg.replace('fill="none"', 'fill="currentColor"');
    return svg;
}

const str = (v) => (typeof v === 'string' ? v : '');

/** A shell command from Claude's string or Codex's argv (`bash -lc "…"` unwrapped). */
function shellCommand(args) {
    const c = args?.command ?? args?.cmd;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
        if (c.length >= 3 && /^(ba|z)?sh$/.test(String(c[0]).split('/').pop()) && /^-l?c$/.test(c[1])) return String(c[2]);
        return c.map(String).join(' ');
    }
    return '';
}

function patchFiles(args) {
    const patch = str(args?.patch) || str(args?.input);
    return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim());
}

/**
 * { icon, text, markdown?, detail } for a tool-call-start view ({ name, title, args }).
 * `markdown` marks text taken from the title, which the protocol allows inline markdown in.
 * `short(path)` shortens paths (e.g. the home directory to ~).
 */
export function describeTool(view, short = (p) => p) {
    const name = String(view.name || '');
    const key = name.toLowerCase();
    const args = view.args && typeof view.args === 'object' ? view.args : {};
    const title = str(view.title);
    const hasTitle = title && title !== `${name} call`;
    const json = () => {
        const text = JSON.stringify(args, null, 2);
        return text.length > 4000 ? text.slice(0, 4000) + '\n…' : text;
    };
    const path = () => short(str(args.file_path) || str(args.path) || str(args.notebook_path));

    if (['bash', 'shell', 'local_shell', 'exec_command', 'execute', 'run_shell_command'].includes(key)) {
        const cmd = shellCommand(args);
        return { icon: 'terminal', text: cmd.split('\n')[0] || title || name, detail: [hasTitle ? title : '', cmd].filter(Boolean).join('\n\n') };
    }
    if (['read', 'notebookread', 'read_file', 'view'].includes(key)) {
        return path() ? { icon: 'file', text: path(), detail: json() } : { icon: 'file', text: title || name, markdown: !!title, detail: json() };
    }
    if (['write', 'edit', 'multiedit', 'notebookedit', 'write_file', 'replace', 'str_replace_based_edit_tool'].includes(key)) {
        return path() ? { icon: 'edit', text: path(), detail: json() } : { icon: 'edit', text: title || name, markdown: !!title, detail: json() };
    }
    if (key === 'apply_patch') {
        const files = patchFiles(args).map(short);
        return { icon: 'edit', text: files.length ? files.join('，') : title || name, detail: str(args.patch) || str(args.input) || json() };
    }
    if (['grep', 'search', 'search_file_content'].includes(key)) {
        const where = short(str(args.path) || str(args.glob));
        return { icon: 'search', text: [str(args.pattern) || str(args.query), where && `在 ${where}`].filter(Boolean).join(' ') || title || name, detail: json() };
    }
    if (['glob', 'ls', 'list_directory', 'find'].includes(key)) {
        return { icon: 'search', text: str(args.pattern) || path() || title || name, detail: json() };
    }
    if (['webfetch', 'web_fetch', 'fetch'].includes(key)) {
        return { icon: 'globe', text: str(args.url) || title || name, detail: json() };
    }
    if (['websearch', 'web_search', 'google_web_search'].includes(key)) {
        return { icon: 'globe', text: str(args.query) || title || name, detail: json() };
    }
    if (['task', 'agent'].includes(key)) {
        return { icon: 'agent', text: str(args.description) || title || '子任务', detail: str(args.prompt) || json() };
    }
    if (['todowrite', 'update_plan'].includes(key)) {
        const items = args.todos ?? args.plan ?? [];
        return { icon: 'todo', text: `更新待办（${Array.isArray(items) ? items.length : 0} 项）`, detail: json() };
    }
    if (key === 'askuserquestion') {
        return { icon: 'ask', text: str(args.questions?.[0]?.question) || '向你提问', detail: json() };
    }
    if (key === 'exitplanmode') {
        return { icon: 'todo', text: '提交计划', detail: str(args.plan) || json() };
    }
    if (key === 'toolsearch') {
        return { icon: 'search', text: `查找工具：${str(args.query) || '…'}`, detail: json() };
    }
    if (hasTitle) return { icon: 'tool', text: title, markdown: true, detail: json() };
    // MCP tools are mcp__<server>__<tool>; show the tool and what it was given.
    const mcp = name.match(/^mcp__(.+?)__(.+)$/);
    const label = mcp ? mcp[2] : name || '工具';
    const firstArg = Object.values(args).find((v) => typeof v === 'string' && v.trim());
    const text = firstArg ? `${label}：${firstArg.split('\n')[0]}` : label;
    return { icon: 'tool', text, detail: (mcp ? `MCP 服务：${mcp[1]}\n\n` : '') + json() };
}

/** 7秒 / 7分2秒 / 1小时3分 */
export function formatDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}秒`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}分${s % 60}秒`;
    return `${Math.floor(m / 60)}小时${m % 60}分`;
}
