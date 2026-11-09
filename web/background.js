// Background tasks (subagents, shell commands) still running after a turn ends.
//
// The CLI forwards nothing while one runs: the SDK's task_started/progress are
// system messages it drops, and the tool call ends at once ("launched"). What
// does reach us:
//   - the launch: a tool call with `run_in_background: true` (an Agent may
//     also carry a `name` to be messaged by) by the main agent, not a subagent;
//   - a resume: SendMessage({ to: <name or agentId>, summary?, message }) to an
//     agent that had stopped;
//   - each stop: a user message wrapped in <task-notification> with the
//     agent's <task-id> and a <tool-use-id> (the launch's, or the resuming
//     SendMessage's).
// An agent is known by its launch call; names, task ids and SendMessage calls
// are aliases of it.
//
// History arrives out of order (the newest page first, older ones on scroll),
// so events are kept by seq and replayed in order whenever asked.
//
// None of that is reliable: the CLI drops the SDK's own task_notification, and
// a task that ends while the agent is mid-turn is reported only inside that
// turn, which never reaches us. So a task can also be dismissed by hand.

import { stripTaskNotifications } from './localCommand.js';

const SEND = 'SendMessage';
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** `dismissed`: launch call -> seq of the (re)start dismissed by hand; kept by the caller across reloads. */
export function backgroundTracker({ dismissed = new Map() } = {}) {
    const events = new Map(); // seq -> view that launches, resumes or stops something
    let clearedAt = -Infinity; // the process ended after this seq
    let maxSeq = -Infinity;

    return {
        /** Feed every decoded message, in any order. */
        see(view, seq) {
            maxSeq = Math.max(maxSeq, seq);
            if (relevant(view)) events.set(seq, view);
        },
        /** What still runs, oldest first: { id: the launch call, label, since: when it (re)started, ms or null }. */
        tasks() {
            return running().filter(({ id, seq }) => dismissed.get(id) !== seq).map(({ id, label, since }) => ({ id, label, since }));
        },
        /** What was dismissed by hand, to be saved: [[launch call, seq]]. */
        dismissed() { return dismissed.entries(); },
        /** Stop showing a task (its end never reached us); it shows again if it is started again. */
        dismiss(id) {
            const task = running().find((t) => t.id === id);
            if (task) dismissed.set(id, task.seq);
        },
        /** What still runs, oldest first, as shown. */
        labels() { return this.tasks().map((t) => t.label); },
        /** The process is gone: nothing seen so far runs any more. */
        clear() { clearedAt = maxSeq; },
    };

    function running() {
        const state = replayState();
        let past = false; // replayed beyond the moment the process ended
        for (const seq of [...events.keys()].sort((x, y) => x - y)) {
            if (!past && seq > clearedAt) { state.running.clear(); past = true; }
            state.see(events.get(seq), seq);
        }
        if (!past) state.running.clear();
        return [...state.running.entries()].map(([id, task]) => ({ id, ...task }));
    }
}

function relevant(view) {
    if (view?.stops?.length) return true;
    return isTaskCall(view);
}

/**
 * A launch or a resume by the main agent. A subagent's own background tasks
 * are left out: their <task-notification> goes to that subagent (forwarded as
 * its text, or lost once it has ended), so we would never see them stop.
 */
const isTaskCall = (view) => view?.kind === 'tool' && !!view.call && !!view.args && !view.subagent
    && (view.args.run_in_background === true || view.name === SEND);

/** When a message was sent: the server's time, else the CLI's. */
const when = (view) => view.at || view.time || null;

function replayState() {
    const agents = new Map();  // launch call -> { name, label }
    const aliases = new Map(); // call / name / task id -> launch call
    const running = new Map(); // launch call -> { label shown, since, seq of the (re)start }

    const resolve = (ref) => (ref == null ? undefined : aliases.get(ref) ?? aliases.get(String(ref).toLowerCase()));

    function launch(view, seq) {
        const a = view.args;
        const name = str(a.name);
        const label = str(a.description) ?? name ?? str(view.title) ?? str(a.command) ?? str(view.name) ?? '后台任务';
        agents.set(view.call, { name, label });
        aliases.set(view.call, view.call);
        if (name) aliases.set(name.toLowerCase(), view.call);
        running.delete(view.call); // newest last
        running.set(view.call, { label, since: when(view), seq });
    }

    function resume(view, seq) {
        const id = resolve(str(view.args?.to));
        if (!id) return; // "main", a teammate, or an agent we never saw start
        const agent = agents.get(id);
        const summary = str(view.args.summary);
        aliases.set(view.call, id);
        running.delete(id);
        const label = summary ? `${agent.name ?? agent.label} · ${summary}` : agent.name ?? agent.label;
        running.set(id, { label, since: when(view), seq });
    }

    function stop({ toolUseId, taskId }) {
        const id = resolve(toolUseId) ?? resolve(taskId);
        if (!id) return;
        if (taskId) aliases.set(taskId, id);
        running.delete(id);
    }

    return {
        running,
        see(view, seq) {
            if (isTaskCall(view)) {
                if (view.args.run_in_background === true) launch(view, seq);
                else if (view.name === SEND) resume(view, seq);
            }
            for (const s of view?.stops ?? []) stop(s);
        },
    };
}

/** The tasks a user message reports as stopped, from its leading <task-notification>s. */
export function backgroundStops(text) {
    if (typeof text !== 'string') return [];
    const visible = stripTaskNotifications(text);
    if (visible === text) return [];
    const trimmed = text.trimStart();
    const head = trimmed.slice(0, trimmed.length - visible.length);
    const tag = (block, name) => block.match(new RegExp(`<${name}>\\s*([^<\\s]+)\\s*</${name}>`))?.[1] ?? null;
    return head.split('<task-notification>').slice(1)
        .map((block) => ({ toolUseId: tag(block, 'tool-use-id'), taskId: tag(block, 'task-id') }))
        .filter((s) => s.toolUseId || s.taskId);
}

/** "后台运行中：A" / "后台运行中：A 等 3 个" */
export function backgroundText(labels) {
    if (!labels.length) return '';
    const last = labels[labels.length - 1];
    return labels.length === 1 ? `后台运行中：${last}` : `后台运行中：${last} 等 ${labels.length} 个`;
}
