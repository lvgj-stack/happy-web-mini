// Questions an agent is waiting on, and the RPC that answers them.
// Mirrors packages/happy-ios/Sources/HappyCore/ChatDisplay/AgentCommunications.swift:
//   - Claude's AskUserQuestion is a pending permission in agentState.requests;
//     it is answered by allowing the permission with `updatedInput.answers`
//     (question text -> chosen labels, comma-joined).
//   - Codex / Happy Agent ask through agentState.communications (kind "form");
//     they are answered with the `communication` RPC.

/**
 * Pending question sets, oldest first:
 * [{ via: 'permission'|'communication', id, createdAt, questions: [{ id, header, question, options, multiSelect, allowCustom, required }] }]
 */
export function pendingQuestions(agentState) {
    if (!agentState) return [];
    const out = [];

    for (const [id, request] of Object.entries(agentState.requests ?? {})) {
        if (request?.tool !== 'AskUserQuestion') continue;
        const questions = (request.arguments?.questions ?? []).map((q, index) => ({
            id: `question-${index}`,
            header: q?.header ?? '',
            question: q?.question ?? '',
            options: (q?.options ?? []).filter((o) => typeof o?.label === 'string')
                .map((o) => ({ label: o.label, description: o.description ?? '' })),
            multiSelect: q?.multiSelect === true,
            allowCustom: true, // Claude takes any text as an answer
            required: true,
        }));
        if (questions.length) out.push({ via: 'permission', id, createdAt: request.createdAt ?? 0, questions });
    }

    const completed = agentState.completedCommunications ?? {};
    for (const [id, c] of Object.entries(agentState.communications ?? {})) {
        if (completed[id] != null || c?.kind !== 'form') continue;
        const questions = (c.form?.questions ?? [])
            .filter((q) => typeof q?.id === 'string' && typeof q?.question === 'string')
            .map((q) => ({
                id: q.id,
                header: q.header ?? '',
                question: q.question,
                options: (q.options ?? []).filter((o) => typeof o?.label === 'string')
                    .map((o) => ({ label: o.label, description: o.description ?? '' })),
                multiSelect: q.multiSelect === true,
                allowCustom: q.allowCustom !== false,
                required: q.required !== false,
            }))
            .filter((q) => q.options.length || q.allowCustom);
        if (questions.length) out.push({ via: 'communication', id, createdAt: c.createdAt ?? 0, questions });
    }

    return out.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

const answered = (draft) => !!draft && (draft.options.length > 0 || draft.custom.trim() !== '');

/** Every required question has a choice or written text. */
export function canSubmit(set, drafts) {
    return set.questions.every((q) => !q.required || answered(drafts[q.id]));
}

/** Toggle an option: single choice moves or clears, multiple choice toggles. */
export function toggle(draft, label, multiSelect) {
    const has = draft.options.includes(label);
    if (!multiSelect) return { ...draft, options: has ? [] : [label] };
    return { ...draft, options: has ? draft.options.filter((l) => l !== label) : [...draft.options, label] };
}

/** The RPC { method, params } that submits the answers. */
export function answerCall(set, drafts) {
    if (set.via === 'permission') {
        const answers = {};
        for (const q of set.questions) {
            const d = drafts[q.id];
            if (!answered(d)) continue;
            const parts = [...(q.multiSelect ? d.options : d.options.slice(0, 1)), d.custom.trim()].filter(Boolean);
            answers[q.question] = parts.join(', ');
        }
        return { method: 'permission', params: { id: set.id, approved: true, decision: 'approved', updatedInput: { answers } } };
    }
    const answers = {};
    for (const q of set.questions) {
        const d = drafts[q.id];
        if (!answered(d)) continue;
        const custom = d.custom.trim();
        answers[q.id] = { options: q.multiSelect ? d.options : d.options.slice(0, 1), ...(custom ? { custom } : {}) };
    }
    return { method: 'communication', params: { id: set.id, kind: 'form', status: 'answered', answers } };
}

/** The RPC { method, params } that declines to answer. */
export function declineCall(set) {
    if (set.via === 'permission') {
        return { method: 'permission', params: { id: set.id, approved: false, decision: 'denied' } };
    }
    return { method: 'communication', params: { id: set.id, kind: 'form', status: 'cancelled' } };
}
