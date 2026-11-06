// node --test: permission modes per agent, and the per-agent default from the settings page.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { agentPermissionOptions, permissionName, permissionOptions } = await import('../permissions.js');
const { defaultsFor, saveDefault } = await import('../defaults.js');
beforeEach(() => store.clear());

const keys = (options) => options.map((o) => o.key);

test('each agent offers the modes Happy CLI accepts for it', () => {
    assert.deepEqual(keys(permissionOptions({ flavor: 'claude' })), ['default', 'acceptEdits', 'plan', 'bypassPermissions']);
    assert.deepEqual(keys(permissionOptions({})), ['default', 'acceptEdits', 'plan', 'bypassPermissions']); // no flavor = Claude
    assert.deepEqual(keys(permissionOptions({ flavor: 'codex' })), ['auto', 'default', 'read-only', 'safe-yolo', 'yolo']);
    assert.deepEqual(keys(permissionOptions({ flavor: 'gemini' })), ['default', 'read-only', 'safe-yolo', 'yolo']);
    assert.deepEqual(keys(agentPermissionOptions('codex')), keys(permissionOptions({ flavor: 'codex' })));
});

test('Happy Agent and unknown agents get none', () => {
    assert.deepEqual(permissionOptions({ client: { id: 'rig' }, flavor: 'claude' }), []);
    assert.deepEqual(permissionOptions({ flavor: 'agy' }), []);
});

test('names', () => {
    assert.equal(permissionName({ flavor: 'claude' }, 'bypassPermissions'), 'YOLO');
    assert.equal(permissionName({ flavor: 'codex' }, 'safe-yolo'), '工作区放行');
    assert.equal(permissionName({ flavor: 'codex' }, 'plan'), '');
});

test('a default permission applies only where the session has that mode', () => {
    saveDefault('codex', 'permission', 'yolo');
    saveDefault('claude', 'permission', 'plan');
    assert.equal(defaultsFor({ flavor: 'codex' }).permission, 'yolo');
    assert.equal(defaultsFor({ flavor: 'claude' }).permission, 'plan');
    assert.equal(defaultsFor({ flavor: 'gemini' }).permission, null);
    assert.equal(defaultsFor({ client: { id: 'rig' }, flavor: 'codex' }).permission, null);
    saveDefault('codex', 'permission', '');
    assert.equal(defaultsFor({ flavor: 'codex' }).permission, null);
});
