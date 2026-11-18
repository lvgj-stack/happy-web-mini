// node --test: which sessions can be forked, and what the daemon is sent.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forkAvailability, forkCopyRequest, forkSpawnParams } from '../fork.js';

const session = (meta = {}, extra = {}) => ({
    id: 's1', active: true,
    meta: { machineId: 'm1', path: '/repo', flavor: 'claude', claudeSessionId: 'c1', ...meta },
    ...extra,
});
const machine = (extra = {}) => ({ id: 'm1', online: true, ...extra });

test('a Claude or Codex session on an online computer can be forked, live or archived', () => {
    assert.deepEqual(forkAvailability(session(), machine()), { show: true, ok: true, reason: '' });
    assert.equal(forkAvailability(session({ flavor: undefined }), machine()).ok, true, 'no flavor means Claude');
    assert.equal(forkAvailability(session({ lifecycleState: 'archived' }, { active: false }), machine()).ok, true);
    assert.equal(forkAvailability(session({ flavor: 'codex', claudeSessionId: undefined, codexThreadId: 't1' }), machine()).ok, true);
});

test('Happy Agent, bots, tasks, side chats and other agents offer nothing', () => {
    for (const meta of [{ client: { id: 'rig' } }, { bot: {} }, { task: {} }, { isSideChat: true },
        { flavor: 'cursor', claudeSessionId: undefined, cursorSessionId: 'x' }, { flavor: 'gemini' }]) {
        assert.equal(forkAvailability(session(meta), machine()).show, false, JSON.stringify(meta));
    }
    assert.equal(forkAvailability(null, machine()).show, false);
});

test('what stands in the way is said', () => {
    const why = (meta, m = machine()) => forkAvailability(session(meta), m).reason;
    assert.equal(why({ claudeSessionId: undefined }), '这个会话还没有 Claude 会话 id，无法 fork');
    assert.equal(why({ flavor: 'codex', claudeSessionId: undefined }), '这个会话还没有 Codex 会话 id，无法 fork');
    assert.equal(why({ path: '' }), '不知道这个会话的目录，无法 fork');
    assert.equal(why({ machineId: undefined }), '不知道这个会话在哪台电脑上，无法 fork');
    assert.equal(why({}, null), '找不到这个会话所在的电脑');
    assert.equal(why({}, machine({ online: false })), '这台电脑不在线');
});

test('the copy RPC: claude-fork-session or codex-fork-thread, and where the new id comes back', () => {
    assert.deepEqual(forkCopyRequest(session()), {
        method: 'claude-fork-session', params: { directory: '/repo', claudeSessionId: 'c1' }, resultKey: 'newClaudeSessionId',
    });
    assert.deepEqual(forkCopyRequest(session({ flavor: 'codex', codexThreadId: 't1' })), {
        method: 'codex-fork-thread', params: { directory: '/repo', codexThreadId: 't1' }, resultKey: 'newCodexThreadId',
    });
});

test('the spawn: a new session resuming the copy, pointing back at its parent', () => {
    assert.deepEqual(forkSpawnParams(session(), 'c2'), {
        type: 'spawn-in-directory', directory: '/repo', approvedNewDirectoryCreation: false,
        agent: 'claude', resumeClaudeSessionId: 'c2', parentSessionId: 's1',
    });
    assert.deepEqual(forkSpawnParams(session({ flavor: 'codex', codexThreadId: 't1' }), 't2'), {
        type: 'spawn-in-directory', directory: '/repo', approvedNewDirectoryCreation: false,
        agent: 'codex', resumeCodexThreadId: 't2', parentSessionId: 's1',
    });
});
