// Bringing an archived or offline session back: the daemon on its computer
// reattaches a CLI to the same session id (`claude --resume`), so its history
// stays. Mirrors happy-ios SessionDetails.resumeAvailability and
// MachineActions.machineResumeSession / resumeFallback.

import { isRig } from './models.js';

const filled = (v) => typeof v === 'string' && v.length > 0;

/**
 * { show, ok, reason }: show = offer it at all; ok = it can be done now;
 * reason = why not, when shown but not ok.
 */
export function resumeAvailability(s, machine) {
    const meta = s?.meta ?? {};
    const hidden = { show: false, ok: false, reason: '' };
    if (!s || (s.active && meta.lifecycleState !== 'archived')) return hidden;
    if (isRig(meta) || meta.capabilities?.resume === false) return hidden;
    const no = (reason) => ({ show: true, ok: false, reason });
    if (!filled(meta.machineId)) return no('不知道这个会话在哪台电脑上，无法恢复');
    if (!filled(meta.claudeSessionId) && !filled(meta.codexThreadId) && !filled(meta.cursorSessionId)) return no('这个会话没有 Claude / Codex / Cursor 会话 id，无法恢复');
    if (!machine) return no('找不到这个会话所在的电脑');
    if (!machine.online) return no('这台电脑不在线');
    if (machine.meta?.resumeSupport?.rpcAvailable !== true) return no('这台电脑上的 happy 版本太旧，不支持恢复会话');
    return { show: true, ok: true, reason: '' };
}

/**
 * What lets a daemon that never tracked the session (started before it, or
 * it restarted since) reattach: the session's own key and state.
 * `keyBase64` is the session's data key, base64.
 */
export function resumeFallback(s, keyBase64) {
    return {
        metadata: s.meta,
        metadataVersion: s.metadataVersion ?? 0,
        agentStateVersion: s.agentStateVersion ?? 0,
        seq: s.seq ?? 0,
        encryptionKey: keyBase64,
        encryptionVariant: 'dataKey',
    };
}

/**
 * What went wrong with a `resume-happy-session` answer, or '' when it worked.
 * A daemon whose handler throws (directory gone, session not tracked…) answers
 * `{ error }` rather than `{ type: 'error' }`, as the iOS app expects
 * (MachineActions.machineResumeSession checks result["error"] first).
 */
export function resumeFailure(r) {
    const why = typeof r?.error === 'string' ? r.error : r?.type === 'error' ? (r.errorMessage || '恢复失败') : '';
    if (why) {
        // happy-cli resumeSessionAttempt: `fs.access(cwd)` before spawning
        const gone = /ENOENT[^']*'([^']+)'/.exec(why);
        return gone ? `会话所在的目录已经不在了（${gone[1]}）` : why;
    }
    if (r?.type === 'requestToApproveDirectoryCreation') return '会话所在的目录已经不在了';
    if (r?.type !== 'success') return '电脑返回了无法识别的结果';
    return '';
}
