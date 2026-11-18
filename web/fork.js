// Forking a session: a new session on the same computer and directory that
// starts from a copy of this one's conversation, which stays as it is.
// Mirrors happy-ios SessionQuickActions.forkSource and
// MachineActions.forkAndSpawn: the daemon copies the Claude JSONL
// (`claude-fork-session`) or Codex thread (`codex-fork-thread`), then
// `spawn-happy-session` starts a session resuming the copy, with
// `parentSessionId` set (the CLI also replays the copied history into it).

import { isRig } from './models.js';

const filled = (v) => typeof v === 'string' && v.trim().length > 0;
const isCodex = (meta) => meta.flavor === 'codex';
const isClaude = (meta) => !meta.flavor || meta.flavor === 'claude';

/**
 * { show, ok, reason }: show = offer it at all; ok = it can be done now;
 * reason = why not, when shown but not ok.
 */
export function forkAvailability(s, machine) {
    const meta = s?.meta ?? {};
    const hidden = { show: false, ok: false, reason: '' };
    if (!s || isRig(meta) || meta.bot || meta.task || meta.isSideChat === true) return hidden;
    if (!isClaude(meta) && !isCodex(meta)) return hidden;
    const no = (reason) => ({ show: true, ok: false, reason });
    if (!filled(meta.machineId)) return no('不知道这个会话在哪台电脑上，无法 fork');
    if (!filled(meta.path)) return no('不知道这个会话的目录，无法 fork');
    if (isCodex(meta) && !filled(meta.codexThreadId)) return no('这个会话还没有 Codex 会话 id，无法 fork');
    if (isClaude(meta) && !filled(meta.claudeSessionId)) return no('这个会话还没有 Claude 会话 id，无法 fork');
    if (!machine) return no('找不到这个会话所在的电脑');
    if (!machine.online) return no('这台电脑不在线');
    return { show: true, ok: true, reason: '' };
}

/** The machine RPC that copies the conversation: { method, params, resultKey } (resultKey: the new id's field). */
export function forkCopyRequest(s) {
    const { path, codexThreadId, claudeSessionId } = s.meta;
    return isCodex(s.meta)
        ? { method: 'codex-fork-thread', params: { directory: path, codexThreadId }, resultKey: 'newCodexThreadId' }
        : { method: 'claude-fork-session', params: { directory: path, claudeSessionId }, resultKey: 'newClaudeSessionId' };
}

/** `spawn-happy-session` params for the fork, given the copy's new Claude session / Codex thread id. */
export function forkSpawnParams(s, newId) {
    const codex = isCodex(s.meta);
    return {
        type: 'spawn-in-directory', directory: s.meta.path, approvedNewDirectoryCreation: false,
        agent: codex ? 'codex' : 'claude',
        [codex ? 'resumeCodexThreadId' : 'resumeClaudeSessionId']: newId,
        parentSessionId: s.id,
    };
}
