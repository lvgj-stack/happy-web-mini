// Background tasks (subagents, shell commands) still running after a turn ends.
//
// The CLI forwards nothing while one runs: the SDK's task_started/progress are
// system messages it drops, and the tool call ends at once ("launched"). What
// does reach us is the call itself, with `run_in_background: true`, and, when
// the task stops, a user message wrapped in <task-notification> naming that
// call's <tool-use-id>. Pairing the two tells what is still running.

import { stripTaskNotifications } from './localCommand.js';

/** A tool call that keeps running in the background: { call, label }, or null. */
export function backgroundStart(view) {
    if (view?.kind !== 'tool' || !view.call || view.args?.run_in_background !== true) return null;
    const a = view.args;
    const label = [a.description, view.title, a.command, view.name].find((v) => typeof v === 'string' && v.trim());
    return { call: view.call, label: (label ?? '后台任务').trim() };
}

/** The tool calls a user message reports as stopped (its leading <task-notification>s). */
export function backgroundStops(text) {
    if (typeof text !== 'string') return [];
    const visible = stripTaskNotifications(text);
    if (visible === text) return [];
    const head = text.trimStart().slice(0, text.trimStart().length - visible.length);
    return [...head.matchAll(/<tool-use-id>\s*([^<\s]+)\s*<\/tool-use-id>/g)].map((m) => m[1]);
}

/** "后台运行中：A" / "后台运行中：A 等 3 个" */
export function backgroundText(labels) {
    if (!labels.length) return '';
    const last = labels[labels.length - 1];
    return labels.length === 1 ? `后台运行中：${last}` : `后台运行中：${last} 等 ${labels.length} 个`;
}
