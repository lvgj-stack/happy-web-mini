// node --test: the version shown in 设置 › 关于.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBuildInfo, versionText } from '../version.js';

const now = new Date(2026, 10, 9, 20, 0).getTime();
const at = new Date(2026, 10, 9, 18, 33).toISOString();

test('the Mac app shows its version, commit and when it was built', () => {
    assert.deepEqual(versionText({ version: '1.0.1', commit: '1a2b3c4', dirty: false, builtAt: at }, now),
        { version: '1.0.1 · 1a2b3c4', detail: 'Mac 应用，打包于 18:33' });
});

test('the browser build says it is the code the server started with, and flags local changes', () => {
    assert.deepEqual(versionText({ source: 'web', version: '1.0.1', commit: '1a2b3c4', dirty: true, builtAt: at }, now),
        { version: '1.0.1 · 1a2b3c4（含未提交的改动）', detail: '网页版，18:33 启动服务时的代码' });
});

test('without build info it says so', () => {
    assert.equal(versionText(null).version, '未知');
});

test('a missing or broken build-info.json reads as none', async () => {
    assert.equal(await loadBuildInfo(async () => ({ ok: false })), null);
    assert.equal(await loadBuildInfo(async () => { throw new Error('offline'); }), null);
    assert.equal(await loadBuildInfo(async () => ({ ok: true, json: async () => ({}) })), null);
    const info = { version: '1.0.1', commit: 'abc' };
    assert.deepEqual(await loadBuildInfo(async () => ({ ok: true, json: async () => info })), info);
});
