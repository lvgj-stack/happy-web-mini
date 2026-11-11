// node --test: model options and how a choice goes on the wire.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CODEX_CONFIG, agentModelOptions, currentModelKey, effortOptions, modelMeta, modelOptions } from '../models.js';

test('Codex offers 跟随 Codex 配置 first, which sends model: null', () => {
    const [first, second] = modelOptions({ flavor: 'codex' });
    assert.equal(first.key, CODEX_CONFIG);
    assert.equal(first.name, '跟随 Codex 配置');
    assert.deepEqual(modelMeta(first), { model: null });
    assert.equal(second.model, second.key); // the GPT catalog follows
    // also when the CLI reports its own list, and on the settings page
    assert.equal(modelOptions({ flavor: 'codex', models: [{ code: 'x', value: 'X' }] })[0].key, CODEX_CONFIG);
    assert.equal(agentModelOptions('codex')[0].key, CODEX_CONFIG);
});

test('other agents do not get it', () => {
    for (const flavor of ['claude', 'gemini']) {
        assert.ok(!modelOptions({ flavor }).some((o) => o.key === CODEX_CONFIG));
        assert.ok(!agentModelOptions(flavor).some((o) => o.key === CODEX_CONFIG));
    }
    assert.ok(!modelOptions({ client: { id: 'rig' }, flavor: 'codex', models: [] }).some((o) => o.key === CODEX_CONFIG));
});

test('a normal choice still sends its model', () => {
    assert.deepEqual(modelMeta({ key: 'gpt-6-sol', model: 'gpt-6-sol' }), { model: 'gpt-6-sol' });
    assert.deepEqual(modelMeta(null), {});
});

test('Cursor offers the models its session reports, and no effort', () => {
    const meta = { flavor: 'cursor', models: [{ code: 'default', value: 'Auto' }, { code: 'gpt-5', value: 'GPT-5' }], currentModelCode: 'gpt-5' };
    assert.deepEqual(modelOptions(meta).map((o) => o.key), ['default', 'gpt-5']);
    assert.equal(currentModelKey(meta), 'gpt-5');
    assert.deepEqual(modelOptions({ flavor: 'cursor' }), []);
    assert.deepEqual(effortOptions(meta, 'gpt-5'), []);
});
