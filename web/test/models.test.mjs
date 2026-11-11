// node --test: model options and how a choice goes on the wire.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CODEX_CONFIG, agentModelOptions, currentModelKey, effortOptions, modelMeta, modelOptions } from '../models.js';
import { defaultsFor, saveDefault } from '../defaults.js';

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

const ferry = {
    id: 'preset-sol-max', model: 'ferry-gpt-6-1-sol-max', displayName: 'Ferry GPT-6.1-Sol Max 1M',
    description: 'GPT-6.1-Sol via TRAE, 1M context',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map((reasoningEffort) => ({ reasoningEffort })),
};

test('Codex catalog uses wire slugs and preserves CLI names, order, descriptions and hidden filtering', () => {
    const astra = { ...ferry, model: 'ferry-astra', displayName: 'Ferry Astra 排35' };
    const meta = { flavor: 'codex', codexModels: [astra, ferry, { ...ferry }, { model: 'hidden', hidden: true }, null] };
    const options = modelOptions(meta);
    assert.deepEqual(options.map((o) => o.key), [CODEX_CONFIG, 'ferry-astra', ferry.model]);
    assert.equal(options[1].name, astra.displayName);
    assert.equal(options[2].name, ferry.displayName);
    assert.equal(options[2].description, ferry.description);
    assert.deepEqual(modelMeta(options[2]), { model: ferry.model });
    assert.deepEqual(agentModelOptions('codex', meta), options);
    assert.deepEqual(modelOptions({ flavor: 'codex', models: [ferry] }), modelOptions({ flavor: 'codex', codexModels: [ferry] }));
});

test('an empty successful Codex catalog stays empty rather than offering hardcoded models', () => {
    assert.deepEqual(modelOptions({ flavor: 'codex', codexModels: [] }).map((o) => o.key), [CODEX_CONFIG]);
});

test('Codex efforts follow the catalog including 跟随 Codex 配置 and models without reasoning', () => {
    const meta = { flavor: 'codex', codexModels: [ferry, { model: 'no-reasoning', supportedReasoningEfforts: [] }], codexConfiguredModel: ferry.model };
    assert.deepEqual(effortOptions(meta, ferry.model), ['low', 'medium', 'high', 'xhigh']);
    assert.deepEqual(effortOptions(meta, CODEX_CONFIG), ['low', 'medium', 'high', 'xhigh']);
    assert.deepEqual(effortOptions(meta, 'no-reasoning'), []);
    assert.equal(currentModelKey(meta), null); // configured model does not prove an existing thread's model
    assert.equal(currentModelKey({ ...meta, currentModelCode: 'thread-model' }), 'thread-model');
});

test('defaults use the queried catalog and drop efforts unsupported by a newly selected model', () => {
    const values = new Map();
    const previous = globalThis.localStorage;
    globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    try {
        const limited = { ...ferry, model: 'limited', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] };
        const meta = { flavor: 'codex', codexModels: [ferry, limited] };
        saveDefault('codex', 'model', ferry.model, meta);
        saveDefault('codex', 'effort', 'high', meta);
        assert.deepEqual(defaultsFor(meta), { modelKey: ferry.model, effort: 'high', permission: null });
        saveDefault('codex', 'model', 'limited', meta);
        assert.deepEqual(defaultsFor(meta), { modelKey: 'limited', effort: null, permission: null });
        assert.equal(defaultsFor({ flavor: 'codex', codexModels: [ferry] }).modelKey, null);
    } finally {
        if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous;
    }
});
