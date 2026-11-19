// Subagents: what an Agent / Task call's child did, kept apart from the main
// agent's steps so the chat shows one line per child that opens to its own.
//
// Session protocol (happy-cli claude/utils/sessionProtocolMapper.ts, happy-wire
// sessionProtocol.ts): every envelope a child produces carries `subagent`, a
// cuid the CLI derives from the launching tool call. The launch is an `Agent`
// tool call whose args carry that id as `sessionSubagent` (Codex's
// `CodexSubagent` may also list several in `sessionSubagents`). A child opens
// with `start { title }` and closes with `stop`; its first text is the prompt
// it was given. The old `Task` tool's call is hidden by the CLI, so such a
// child shows up with no launch at all.
// Matching follows happy-android chat/ReducerTracer.kt (`input.sessionSubagent`).

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The subagent ids a main-agent tool call launches ([] for any other call). */
export function launchedSubagents(view) {
    if (view?.kind !== 'tool' || view.subagent || !view.args || typeof view.args !== 'object') return [];
    const ids = [];
    for (const id of [view.args.sessionSubagent, ...(Array.isArray(view.args.sessionSubagents) ? view.args.sessionSubagents : [])]) {
        if (str(id) && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

/**
 * Every child's steps, fed decoded views in any order (history pages arrive
 * newest first). `see` keeps a step of a child; the rest reads them back.
 */
export function subagentStore() {
    const children = new Map(); // id -> { id, title, steps: Map seq -> view, ended: Set of calls, stopped, first, last }

    const child = (id) => {
        let c = children.get(id);
        if (!c) {
            c = { id, title: null, steps: new Map(), ended: new Set(), stoppedAt: null, startedAt: null, first: null, last: null };
            children.set(id, c);
        }
        return c;
    };

    return {
        /** Keep a child's step; returns its id, or null when the view is not a child's. */
        see(view, seq) {
            const id = view?.subagent;
            if (!id) return null;
            const c = child(id);
            if (view.time) {
                c.first = Math.min(c.first ?? view.time, view.time);
                c.last = Math.max(c.last ?? view.time, view.time);
            }
            switch (view.kind) {
                case 'subagent-start':
                    c.title ??= str(view.title);
                    c.startedAt = Math.max(c.startedAt ?? -Infinity, seq);
                    break;
                case 'subagent-stop': c.stoppedAt = Math.max(c.stoppedAt ?? -Infinity, seq); break;
                case 'tool-end': c.ended.add(view.call); break;
                default: c.steps.set(seq, view);
            }
            return id;
        },
        has(id) { return children.has(id); },
        /** A child's steps, oldest first: [{ seq, view }]. */
        steps(id) {
            const c = children.get(id);
            if (!c) return [];
            return [...c.steps.entries()].sort((a, b) => a[0] - b[0]).map(([seq, view]) => ({ seq, view }));
        },
        /** Whether a child's tool call has ended. */
        ended(id, call) { return !!children.get(id)?.ended.has(call); },
        /** What a child is, as its line shows it: { title, tools, stopped, first, last }. */
        summary(id) {
            const c = children.get(id);
            if (!c) return { title: null, tools: 0, stopped: false, first: null, last: null };
            let tools = 0;
            for (const view of c.steps.values()) if (view.kind === 'tool') tools++;
            // Codex re-opens a child it resumes: only a stop after the latest start counts.
            const stopped = c.stoppedAt != null && c.stoppedAt > (c.startedAt ?? -Infinity);
            return { title: c.title, tools, stopped, first: c.first, last: c.last };
        },
        /** Whether a child did anything worth a line of its own (Codex's report only that they started). */
        worked(id) {
            const c = children.get(id);
            if (!c) return false;
            for (const view of c.steps.values()) if (view.kind === 'tool' || view.kind === 'agent' || view.kind === 'thinking') return true;
            return false;
        },
    };
}

/** "3 步" for a child's line ('' before its first tool). */
export function stepsText(tools) {
    return tools > 0 ? `${tools} 步` : '';
}
