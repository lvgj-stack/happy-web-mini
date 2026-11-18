// node --test: whether a disconnected session can be resumed, and what the daemon is sent.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resumeAvailability, resumeFallback, resumeFailure } from '../resume.js';

const session = (meta = {}, extra = {}) => ({
    id: 's1', active: false, seq: 42, metadataVersion: 7, agentStateVersion: 3,
    meta: { machineId: 'm1', path: '/repo', flavor: 'claude', claudeSessionId: 'c1', lifecycleState: 'archived', ...meta },
    ...extra,
});
const machine = (extra = {}) => ({ id: 'm1', online: true, meta: { resumeSupport: { rpcAvailable: true } }, ...extra });

test('an archived or offline session on an online, capable computer can be resumed', () => {
    assert.deepEqual(resumeAvailability(session(), machine()), { show: true, ok: true, reason: '' });
    assert.equal(resumeAvailability(session({ lifecycleState: 'running' }), machine()).ok, true, 'offline, not archived');
    assert.equal(resumeAvailability(session({ flavor: 'codex', claudeSessionId: undefined, codexThreadId: 't1' }), machine()).ok, true);
    assert.equal(resumeAvailability(session({ flavor: 'cursor', claudeSessionId: undefined, cursorSessionId: 'cur1' }), machine()).ok, true);
});

test('a live session offers nothing', () => {
    assert.deepEqual(resumeAvailability(session({ lifecycleState: 'running' }, { active: true }), machine()), { show: false, ok: false, reason: '' });
});

test('Happy Agent sessions and ones that refuse resume offer nothing', () => {
    assert.equal(resumeAvailability(session({ client: { id: 'rig' } }), machine()).show, false);
    assert.equal(resumeAvailability(session({ capabilities: { resume: false } }), machine()).show, false);
});

test('what stands in the way is said', () => {
    assert.deepEqual(resumeAvailability(session({ machineId: undefined }), machine()), { show: true, ok: false, reason: '不知道这个会话在哪台电脑上，无法恢复' });
    assert.deepEqual(resumeAvailability(session({ claudeSessionId: '' }), machine()), { show: true, ok: false, reason: '这个会话没有 Claude / Codex / Cursor 会话 id，无法恢复' });
    assert.deepEqual(resumeAvailability(session(), null), { show: true, ok: false, reason: '找不到这个会话所在的电脑' });
    assert.deepEqual(resumeAvailability(session(), machine({ online: false })), { show: true, ok: false, reason: '这台电脑不在线' });
    assert.deepEqual(resumeAvailability(session(), machine({ meta: {} })), { show: true, ok: false, reason: '这台电脑上的 happy 版本太旧，不支持恢复会话' });
});

test('the fallback carries the session key and versions the daemon reattaches with', () => {
    assert.deepEqual(resumeFallback(session(), 'KEY'), {
        metadata: session().meta,
        metadataVersion: 7,
        agentStateVersion: 3,
        seq: 42,
        encryptionKey: 'KEY',
        encryptionVariant: 'dataKey',
    });
    const fresh = resumeFallback({ ...session(), seq: undefined, metadataVersion: undefined, agentStateVersion: undefined }, 'KEY');
    assert.equal(fresh.seq, 0);
    assert.equal(fresh.metadataVersion, 0);
    assert.equal(fresh.agentStateVersion, 0);
});

test('a resume answer that failed says why', () => {
    assert.equal(resumeFailure({ type: 'success', sessionId: 's1' }), '');
    // What the daemon answers when its handler throws: { error }, not { type: 'error' }
    assert.equal(
        resumeFailure({ error: "Failed to resume session: ENOENT: no such file or directory, access '/repo/.dev/worktree/gone'" }),
        '会话所在的目录已经不在了（/repo/.dev/worktree/gone）',
    );
    assert.equal(resumeFailure({ error: 'Session s1 has no metadata. Cannot resume.' }), 'Session s1 has no metadata. Cannot resume.');
    assert.equal(resumeFailure({ type: 'error', errorMessage: 'busy' }), 'busy');
    assert.equal(resumeFailure({ type: 'error' }), '恢复失败');
    assert.equal(resumeFailure({ type: 'requestToApproveDirectoryCreation', directory: '/x' }), '会话所在的目录已经不在了');
    assert.equal(resumeFailure(null), '电脑返回了无法识别的结果');
});
