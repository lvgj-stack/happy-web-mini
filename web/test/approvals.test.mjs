// node --test: tool approvals an agent waits on (agentState.requests other than AskUserQuestion).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvalCall, canApproveForSession, describeApproval, pendingApprovals } from '../approvals.js';

const state = {
    requests: {
        q1: { tool: 'AskUserQuestion', arguments: { questions: [] }, createdAt: 1 },
        b: { tool: 'CodexBash', arguments: { command: 'rm -rf build', cwd: '/Users/x/code/demo' }, createdAt: 30 },
        a: { tool: 'codex_document_control.execute_document_command', arguments: { title: '新会话问候' }, createdAt: 20 },
        broken: { arguments: {} },
    },
};

test('every request but AskUserQuestion, oldest first', () => {
    const sets = pendingApprovals(state);
    assert.deepEqual(sets.map((s) => s.id), ['a', 'b']);
    assert.deepEqual(sets[0], { via: 'approval', id: 'a', tool: 'codex_document_control.execute_document_command', args: { title: '新会话问候' }, createdAt: 20 });
    assert.deepEqual(pendingApprovals(null), []);
    assert.deepEqual(pendingApprovals({}), []);
});

test('allow / allow for the session / deny go out as the permission RPC', () => {
    const set = { via: 'approval', id: 'b' };
    assert.deepEqual(approvalCall(set, 'allow'), { method: 'permission', params: { id: 'b', approved: true, decision: 'approved' } });
    assert.deepEqual(approvalCall(set, 'session'), { method: 'permission', params: { id: 'b', approved: true, decision: 'approved_for_session' } });
    assert.deepEqual(approvalCall(set, 'deny'), { method: 'permission', params: { id: 'b', approved: false, decision: 'denied' } });
});

test('allow for the session is offered to Codex only', () => {
    assert.equal(canApproveForSession({ flavor: 'codex' }), true);
    assert.equal(canApproveForSession({ flavor: 'cursor' }), true);
    assert.equal(canApproveForSession({ flavor: 'claude' }), false);
    assert.equal(canApproveForSession({}), false);
});

test('a command shows the command and where it runs', () => {
    const d = describeApproval({ tool: 'CodexBash', args: { command: 'rm -rf build\necho done', cwd: '/Users/x/code/demo' } }, (p) => p.replace('/Users/x', '~'));
    assert.equal(d.title, '运行命令');
    assert.equal(d.text, 'rm -rf build');
    assert.equal(d.where, '~/code/demo');
    assert.match(d.detail, /echo done/);
});

test('a patch lists its files', () => {
    const d = describeApproval({ tool: 'CodexPatch', args: { changes: { '/Users/x/a.js': { type: 'update' }, '/Users/x/b.js': { type: 'add' } } } }, (p) => p.replace('/Users/x', '~'));
    assert.equal(d.title, '修改文件');
    assert.equal(d.text, '~/a.js，~/b.js');
    assert.match(d.detail, /"type": "add"/);
});

test('any other tool shows its name and first argument', () => {
    const d = describeApproval({ tool: 'codex_document_control.execute_document_command', args: { title: '新会话问候' } });
    assert.equal(d.title, '调用工具');
    assert.equal(d.text, 'codex_document_control.execute_document_command：新会话问候');
    assert.match(d.detail, /新会话问候/);
});

test("Claude's tools get a plain title, ExitPlanMode asks to approve the plan", () => {
    assert.equal(describeApproval({ tool: 'Bash', args: { command: 'npm test' } }).title, '运行命令');
    assert.equal(describeApproval({ tool: 'Edit', args: { file_path: '/a.js' } }).title, '修改文件');
    const plan = describeApproval({ tool: 'ExitPlanMode', args: { plan: '1. 改 a\n2. 改 b' } });
    assert.equal(plan.title, '批准计划');
    assert.equal(plan.detail, '1. 改 a\n2. 改 b');
});
