// Which models a session can switch to, and how a choice goes on the wire.
// Mirrors packages/happy-ios/Sources/HappyCore/Composer/ModelModeOptions.swift,
// RigCatalog.swift and Settings/AgentDefaults.swift (hardcodedModels).

const HARDCODED = {
    claude: [
        ['claude-fable-5-1', 'Fable 5.1'],
        ['claude-fable-5', 'Fable 5'],
        ['claude-opus-5-5', 'Opus 5.5'],
        ['claude-opus-5', 'Opus 5'],
        ['claude-sonnet-5-5', 'Sonnet 5.5'],
        ['claude-haiku-5-5', 'Haiku 5.5'],
    ],
    codex: [
        ['gpt-6-astra', 'GPT-6 Astra'],
        ['gpt-6.1-sol', 'GPT-6.1 Sol'],
        ['gpt-6-sol', 'GPT-6 Sol'],
        ['gpt-6-luna', 'GPT-6 Luna'],
        ['gpt-5.6-sol', 'GPT-5.6 Sol'],
        ['gpt-5.6-terra', 'GPT-5.6 Terra'],
        ['gpt-5.6-luna', 'GPT-5.6 Luna'],
    ],
    gemini: [
        ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro'],
        ['gemini-3-flash-preview', 'Gemini 3 Flash'],
        ['gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite'],
        ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
        ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
        ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite'],
    ],
};

const nonEmpty = (...values) => values.find((v) => typeof v === 'string' && v.trim() !== '');

export const isRig = (meta) => meta?.client?.id === 'rig';

/**
 * Options for a session: [{ key, name, model, providerId? }].
 * `key` is what the picker stores; `model`/`providerId` go into message meta.
 */
export function modelOptions(meta) {
    if (isRig(meta)) {
        return (meta.models ?? []).map((m) => {
            const providerId = nonEmpty(m.provider?.id, m.providerId);
            const id = nonEmpty(m.id, m.code);
            if (!providerId || !id) return null;
            const providerName = nonEmpty(m.provider?.name, m.providerName) ?? providerId;
            return { key: `${providerId}:${id}`, name: `${nonEmpty(m.name, m.value) ?? id}（${providerName}）`, model: id, providerId };
        }).filter(Boolean);
    }
    const fromCli = (meta?.models ?? [])
        .filter((m) => typeof m?.code === 'string')
        .map((m) => ({ key: m.code, name: m.value || m.code, model: m.code }));
    if (fromCli.length) return fromCli;
    const flavor = meta?.flavor || 'claude';
    return (HARDCODED[flavor] ?? []).map(([key, name]) => ({ key, name, model: key }));
}

/** The model the session reports it is on, as an option key, if any. */
export function currentModelKey(meta) {
    if (isRig(meta)) {
        const mode = meta.draft ?? meta.lastMode;
        const provider = nonEmpty(mode?.providerId, meta.currentModelProviderId, meta.model?.providerId);
        const id = nonEmpty(mode?.modelId, meta.currentModelCode, meta.model?.id);
        return provider && id ? `${provider}:${id}` : null;
    }
    return nonEmpty(meta?.currentModelCode, meta?.modelMode) ?? null;
}

/** Message meta fields for a chosen option (nothing when none was chosen). */
export function modelMeta(option) {
    if (!option) return {};
    return option.providerId ? { model: option.model, modelProviderId: option.providerId } : { model: option.model };
}

// ---------- Effort (thinking strength) ----------

const CLAUDE_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'];
const CODEX_EFFORT = {
    'gpt-6-astra': ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    'gpt-6.1-sol': ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    'gpt-6-sol': ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    'gpt-6-luna': ['low', 'medium', 'high', 'xhigh', 'max'],
    'gpt-5.6-sol': ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    'gpt-5.6-terra': ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    'gpt-5.6-luna': ['low', 'medium', 'high', 'xhigh', 'max'],
};

export const effortName = (key) => (key === 'xhigh' ? 'xHigh' : key.charAt(0).toUpperCase() + key.slice(1));

/** Effort levels the session's model accepts, for a model option key (chosen or current). */
export function effortOptions(meta, modelKey) {
    if (isRig(meta)) {
        const [providerId, ...rest] = (modelKey ?? '').split(':');
        const id = rest.join(':');
        const model = (meta.models ?? []).find((m) =>
            nonEmpty(m.provider?.id, m.providerId) === providerId && nonEmpty(m.id, m.code) === id);
        if (model?.thinkingLevels?.length) return model.thinkingLevels;
        if (meta.reasoning?.levels?.length) return meta.reasoning.levels;
        return (meta.thoughtLevels ?? []).map((t) => t?.code).filter(Boolean);
    }
    switch (meta?.flavor || 'claude') {
        case 'claude': return CLAUDE_EFFORT;
        case 'codex': return CODEX_EFFORT[modelKey] ?? ['low', 'medium', 'high', 'xhigh'];
        case 'agy': return modelKey === 'Gemini 3.8 Flash' ? ['low', 'medium', 'high'] : [];
        default: return [];
    }
}

/** The effort the session reports it is on, if it says. */
export function currentEffort(meta) {
    if (isRig(meta)) {
        const mode = meta.draft ?? meta.lastMode;
        return nonEmpty(mode?.effort, meta.reasoning?.current, meta.currentThoughtLevelCode) ?? null;
    }
    return nonEmpty(meta?.effortLevel, meta?.effort) ?? null;
}

/** The agents the settings page offers defaults for, with their model lists. */
export const DEFAULT_AGENTS = [
    { id: 'claude', name: 'Claude Code' },
    { id: 'codex', name: 'Codex' },
    { id: 'gemini', name: 'Gemini' },
];

/** [{ key, name, model }] an agent's hardcoded catalog (the same lists the composer falls back to). */
export function agentModelOptions(agent) {
    return (HARDCODED[agent] ?? []).map(([key, name]) => ({ key, name, model: key }));
}
