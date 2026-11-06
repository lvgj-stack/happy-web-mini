// ↑ / ↓ in an empty composer walk back through what was sent in this chat,
// like a shell. The steps are pure; app.js reads the keys and the textarea.

/** The person's messages, oldest first, from a Map of seq -> text; a repeat of the one before is dropped. */
export function promptHistory(prompts) {
    const out = [];
    for (const [, text] of [...(prompts ?? new Map())].sort((a, b) => a[0] - b[0])) {
        const t = text.trim();
        if (t && t !== out[out.length - 1]) out.push(t);
    }
    return out;
}

export const onFirstLine = (value, pos) => !value.slice(0, pos).includes('\n');
export const onLastLine = (value, pos) => !value.slice(pos).includes('\n');

/**
 * One step through `history` (oldest first). `browse` is null or
 * { index, draft, text }: `index` counts back from the newest (1 = newest),
 * `draft` is what the box held before, `text` what this put there.
 * Returns { browse, text } for the new state and box content, or null when
 * there is nowhere to go.
 */
export function stepHistory(history, browse, dir, current) {
    if (dir === 'up') {
        const index = (browse?.index ?? 0) + 1;
        if (index > history.length) return null;
        const text = history[history.length - index];
        return { browse: { index, draft: browse ? browse.draft : current, text }, text };
    }
    if (!browse) return null;
    const index = browse.index - 1;
    if (index === 0) return { browse: null, text: browse.draft };
    const text = history[history.length - index];
    return { browse: { index, draft: browse.draft, text }, text };
}
