// Default model and effort per agent, set on the settings page and kept in
// this browser. They apply to any message in a session where nothing was
// picked in the composer; Happy Agent sessions have their own catalog and
// never take them.
import { DEFAULT_AGENTS, effortOptions, isRig, modelOptions } from './models.js';
import { permissionOptions } from './permissions.js';

const KEY = 'happy.defaults';

/** { claude: { model?, effort?, permission? }, codex: {...}, gemini: {...} } */
export function loadDefaults() {
    try {
        return JSON.parse(localStorage.getItem(KEY) || '{}') ?? {};
    } catch {
        return {};
    }
}

export function saveDefault(agent, field, value, meta = { flavor: agent }) {
    const all = loadDefaults();
    const entry = { ...(all[agent] ?? {}) };
    if (value) entry[field] = value; else delete entry[field];
    // An effort the new model does not take is dropped with it.
    if (field === 'model' && entry.effort && !effortOptions(meta, entry.model ?? '').includes(entry.effort)) {
        delete entry.effort;
    }
    all[agent] = entry;
    localStorage.setItem(KEY, JSON.stringify(all));
    return all;
}

const agentOf = (meta) => {
    const flavor = meta?.flavor || 'claude';
    return DEFAULT_AGENTS.some((a) => a.id === flavor) ? flavor : null;
};

/**
 * The defaults that apply to a session: { modelKey, effort, permission } (any may be null).
 * A default the session cannot take (not in its model list, or an effort its
 * model lacks) is left out rather than sent.
 */
export function defaultsFor(meta, modelKeyForEffort) {
    const none = { modelKey: null, effort: null, permission: null };
    if (isRig(meta)) return none;
    const agent = agentOf(meta);
    if (!agent) return none;
    const d = loadDefaults()[agent] ?? {};
    const modelKey = d.model && modelOptions(meta).some((o) => o.key === d.model) ? d.model : null;
    const effortModel = modelKeyForEffort ?? modelKey ?? '';
    const effort = d.effort && effortOptions(meta, effortModel).includes(d.effort) ? d.effort : null;
    const permission = d.permission && permissionOptions(meta).some((o) => o.key === d.permission) ? d.permission : null;
    return { modelKey, effort, permission };
}
