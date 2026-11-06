// Tool approvals an agent is waiting on: every pending permission in
// agentState.requests other than AskUserQuestion (questions.js answers that).
// Codex asks for commands (CodexBash), patches (CodexPatch) and app / MCP
// tools; Claude for tools outside its permission mode. All are answered with
// the `permission` RPC: { id, approved, decision }.
import { describeTool } from './tools.js';

const QUESTION_TOOLS = new Set(['AskUserQuestion']);

/** [{ via: 'approval', id, tool, args, createdAt }], oldest first. */
export function pendingApprovals(agentState) {
    return Object.entries(agentState?.requests ?? {})
        .filter(([, r]) => typeof r?.tool === 'string' && !QUESTION_TOOLS.has(r.tool))
        .map(([id, r]) => ({ via: 'approval', id, tool: r.tool, args: r.arguments ?? {}, createdAt: r.createdAt ?? 0 }))
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

const DECISIONS = {
    allow: { approved: true, decision: 'approved' },
    session: { approved: true, decision: 'approved_for_session' },
    deny: { approved: false, decision: 'denied' },
};

/** The RPC { method, params } for 'allow' | 'session' | 'deny'. */
export function approvalCall(set, choice) {
    return { method: 'permission', params: { id: set.id, ...DECISIONS[choice] } };
}

/** 「本会话都允许」: Codex takes approved_for_session; Claude's handler has no such decision. */
export const canApproveForSession = (meta) => meta?.flavor === 'codex';

const capped = (text) => (text.length > 4000 ? text.slice(0, 4000) + '\n…' : text);

/** { title, icon, text, where?, detail } for the card. `short` shortens paths (home to ~). */
export function describeApproval(set, short = (p) => p) {
    const args = set.args && typeof set.args === 'object' ? set.args : {};
    if (set.tool === 'CodexBash') {
        const d = describeTool({ name: 'bash', args: { command: args.command } }, short);
        return { title: '运行命令', icon: d.icon, text: d.text, where: typeof args.cwd === 'string' ? short(args.cwd) : '', detail: d.detail };
    }
    if (set.tool === 'CodexPatch') {
        const changes = args.changes ?? {};
        const paths = Array.isArray(changes) ? changes.map((c) => c?.path).filter(Boolean) : Object.keys(changes);
        return { title: '修改文件', icon: 'edit', text: paths.map(short).join('，') || '修改文件', detail: capped(JSON.stringify(changes, null, 2)) };
    }
    if (set.tool === 'ExitPlanMode' || set.tool === 'exit_plan_mode') {
        return { title: '批准计划', icon: 'todo', text: '计划写好了，批准后开始执行', detail: typeof args.plan === 'string' ? args.plan : capped(JSON.stringify(args, null, 2)) };
    }
    const d = describeTool({ name: set.tool, args }, short);
    return { title: TITLES[d.icon] ?? '调用工具', icon: d.icon, text: d.text, detail: d.detail };
}

/** Claude's own tools, by the icon describeTool gives them. */
const TITLES = { terminal: '运行命令', edit: '修改文件', file: '读取文件', search: '搜索', globe: '访问网络' };
