// Which models a session can switch to, and how a choice goes on the wire.
// Mirrors packages/happy-ios/Sources/HappyCore/Composer/ModelModeOptions.swift,
// RigCatalog.swift and Settings/AgentDefaults.swift (hardcodedModels).
// Codex uses its app-server catalog when available, retaining this fallback
// for offline sessions. Cursor reports its own catalog in meta.models.

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
 * Codex only: 跟随 Codex 配置. Happy CLI otherwise starts Codex on its own
 * built-in default (a GPT model); an explicit `model: null` makes it leave the
 * model out, so Codex takes model and provider from its config.toml.
 */
export const CODEX_CONFIG = 'codex-config';
const CODEX_CONFIG_OPTION = { key: CODEX_CONFIG, name: '跟随 Codex 配置', model: null };
const withCodexConfig = (flavor, options) => (flavor === 'codex' ? [CODEX_CONFIG_OPTION, ...options] : options);

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
    const flavor = meta?.flavor || 'claude';
    if (flavor === 'codex' && Array.isArray(meta?.codexModels)) {
        return withCodexConfig(flavor, codexOptions(meta.codexModels));
    }
    if (flavor === 'codex' && meta?.models?.some((m) => m?.model || m?.displayName)) {
        return withCodexConfig(flavor, codexOptions(meta.models));
    }
    const fromCli = (meta?.models ?? [])
        .filter((m) => typeof m?.code === 'string')
        .map((m) => ({ key: m.code, name: m.value || m.code, model: m.code }));
    if (fromCli.length) return withCodexConfig(flavor, fromCli);
    return withCodexConfig(flavor, (HARDCODED[flavor] ?? []).map(([key, name]) => ({ key, name, model: key })));
}

/** Codex's wire model slug is distinct from its display/preset id. */
function codexOptions(models) {
    const seen = new Set();
    return models.map((m) => {
        const model = nonEmpty(m?.model, m?.code, m?.id);
        if (!model || m.hidden || seen.has(model)) return null;
        seen.add(model);
        return { key: model, name: nonEmpty(m.displayName, m.value, m.name) ?? model, model, description: m.description ?? '' };
    }).filter(Boolean);
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

/** Message meta fields for a chosen option (nothing when none was chosen; `model: null` for 跟随 Codex 配置). */
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
        case 'codex': {
            const key = modelKey === CODEX_CONFIG ? meta.codexConfiguredModel : modelKey;
            const model = (meta.codexModels ?? meta.models ?? []).find((m) => nonEmpty(m?.model, m?.code, m?.id) === key);
            if (Array.isArray(model?.supportedReasoningEfforts)) {
                return [...new Set(model.supportedReasoningEfforts.map((e) => nonEmpty(e?.reasoningEffort, e)).filter(Boolean))];
            }
            return CODEX_EFFORT[key] ?? ['low', 'medium', 'high', 'xhigh'];
        }
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
    { id: 'cursor', name: 'Cursor' },
];

/** [{ key, name, model }] an agent's hardcoded catalog (the same lists the composer falls back to). */
export function agentModelOptions(agent, meta) {
    if (meta) return modelOptions({ ...meta, flavor: agent });
    return withCodexConfig(agent, (HARDCODED[agent] ?? []).map(([key, name]) => ({ key, name, model: key })));
}
