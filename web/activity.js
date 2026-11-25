// Mirrors happy-cli codex/utils/sessionProtocolMapper.ts ensureCodexEnvelopeTurn:
// automatic continuations get a turn even without task_started. runCodex.ts's
// heartbeat only flips thinking on task_started, so turn messages also matter.

/** How long an ended turn's lagging thinking keepalive is ignored. */
export const THINKING_MUTE = 2500;

/** Main-agent work reported by either a heartbeat or an unfinished protocol turn. */
export function isThinking(s) {
    return !!s.active && (!!s.thinking || !!s.turnActivity?.running);
}

/** Track main-turn evidence in server seq order, independent of whether its chat is open. */
export function noteTurnActivity(s, raw, seq, now = Date.now(), sentAt = null) {
    // runCodex.ts sendReady / finally also end work when a crashed provider
    // returns without a turn-end (codexAppServerClient.ts's process exit path).
    const status = raw?.role === 'agent' && raw.content?.type === 'event' ? raw.content.data : null;
    const ready = status?.type === 'ready';
    if (ready) {
        s.lastReadySeq = Math.max(s.lastReadySeq ?? 0, seq);
        // runCodex.ts's finally can emit the previous turn's ready after an
        // automatic continuation has already started. A known end consumes it.
        if (s.readyAfterEndSeq && seq > s.readyAfterEndSeq) {
            s.readyAfterEndSeq = 0;
            return;
        }
    }
    const idle = status?.type === 'ready'
        || (status?.type === 'message' && status.message === 'Process exited unexpectedly');
    const env = raw?.role === 'session'
        ? (raw.content?.type === 'session' ? raw.content.data : raw.content)
        : null;
    if (!idle) {
        if (env?.role !== 'agent' || env.subagent || !env.turn) return;
        const ev = env.ev;
        if (!['turn-start', 'turn-end', 'text', 'service', 'tool-call-start', 'tool-call-end'].includes(ev?.t)) return;
        if ((ev.t === 'text' || ev.t === 'service') && !ev.text?.trim()) return;
    }
    if (env?.ev?.t === 'turn-end' && seq > (s.lastReadySeq ?? 0)) {
        s.readyAfterEndSeq = Math.max(s.readyAfterEndSeq ?? 0, seq);
    }
    const previous = s.turnActivity;
    if (seq <= (previous?.seq ?? 0)) return; // paging back or decrypting a push out of order
    const ended = idle || env.ev.t === 'turn-end';
    if (!ended && previous?.turn === env.turn && previous.ended) return;
    s.turnActivity = { turn: idle ? previous?.turn ?? null : env.turn, seq, ended, running: !ended && !!s.active };
    if (ended) {
        s.thinking = false;
        s.thinkingMutedUntil = now + THINKING_MUTE; // browser clock; CLI/server clocks can differ
        // sessionUpdateHandler.ts clamps future CLI keepalive times to the
        // server clock but preserves past ones. Apply the same upper bound to
        // the CLI envelope time; ready events have no time, so use the last ping.
        s.thinkingEndedAt = env?.time > 0 ? Math.min(env.time, sentAt ?? Infinity) : s.activeAt ?? 0;
    } else {
        s.thinkingMutedUntil = 0; // a real new turn can start inside the mute window
        s.thinkingEndedAt = 0;
    }
}

/** Apply a keepalive; idle heartbeats cannot cancel explicit unfinished turn evidence. */
export function setActivity(s, event, now = Date.now()) {
    s.active = event.active;
    s.activeAt = event.activeAt ?? s.activeAt;
    const stale = event.activeAt != null && event.activeAt <= (s.thinkingEndedAt ?? 0);
    s.thinking = !!event.thinking && !!event.active && !stale && now >= (s.thinkingMutedUntil ?? 0);
    if (!s.active && s.turnActivity?.running) {
        s.turnActivity = { ...s.turnActivity, running: false };
    }
}
