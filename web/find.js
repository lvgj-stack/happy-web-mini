// Find in page (⌘F) for the Mac app, where there is no browser find bar.
// A browser keeps its own; app.js only opens this when desktop.active.
// Matches are painted with the CSS Custom Highlight API, so the page's DOM
// is never touched. Electron's webContents.findInPage is not used: it also
// matches what is typed into the find box itself.

/** Where `query` starts in `text`, ignoring case; no overlaps, empty query finds nothing. */
export function findMatches(text, query) {
    const q = query.toLowerCase();
    if (!q) return [];
    const t = text.toLowerCase();
    // Lower-casing can change the length of a few characters (İ); then offsets would drift.
    if (t.length !== text.length) return [];
    const out = [];
    for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + q.length)) out.push(i);
    return out;
}

/** The index after `index` among `count` matches going 'next' or 'prev', wrapping; -1 when there are none. */
export function stepMatch(index, count, dir) {
    if (count <= 0) return -1;
    if (index < 0 || index >= count) return dir === 'prev' ? count - 1 : 0;
    return (index + (dir === 'prev' ? -1 : 1) + count) % count;
}

/** What the counter says: '3/12', '0/0' for nothing found, '' with no query. */
export function matchLabel(index, count, query) {
    if (!query) return '';
    return count ? `${index + 1}/${count}` : '0/0';
}

/**
 * Find over `root`'s visible text, skipping `skip` (the find bar). Call
 * search() when the query changes, step() for next / previous, clear() on close.
 * Touches the DOM only when called.
 */
export function createFinder(root, skip) {
    let ranges = [];
    let index = -1;
    let query = '';

    const supported = () => typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';

    function collect() {
        const out = [];
        if (!query) return out;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent || skip?.contains(parent)) return NodeFilter.FILTER_REJECT;
                if (parent.closest('script, style, template, textarea, input, select')) return NodeFilter.FILTER_REJECT;
                if (parent.checkVisibility && !parent.checkVisibility({ visibilityProperty: true })) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            for (const start of findMatches(node.data, query)) {
                const r = document.createRange();
                r.setStart(node, start);
                r.setEnd(node, start + query.length);
                out.push(r);
            }
        }
        return out;
    }

    function paint() {
        if (!supported()) return;
        if (!ranges.length) { CSS.highlights.delete('find-match'); CSS.highlights.delete('find-current'); return; }
        CSS.highlights.set('find-match', new Highlight(...ranges));
        const current = ranges[index];
        if (current) CSS.highlights.set('find-current', new Highlight(current));
        else CSS.highlights.delete('find-current');
    }

    function reveal() {
        const r = ranges[index];
        const el = r?.startContainer.parentElement;
        if (!el) return;
        // Open collapsed <details> the match sits in, the way a browser's find does.
        for (let d = el.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) d.open = true;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }

    const state = () => ({ index, count: ranges.length, label: matchLabel(index, ranges.length, query) });

    return {
        supported,
        /** New query: highlight everything, jump to the first match. */
        search(q) {
            query = q;
            ranges = collect();
            index = ranges.length ? 0 : -1;
            paint();
            reveal();
            return state();
        },
        /** The page changed under an open find: recount, keep the place. */
        refresh() {
            if (!query) return state();
            const before = ranges[index];
            ranges = collect();
            const same = before ? ranges.findIndex((r) => r.startContainer === before.startContainer && r.startOffset === before.startOffset) : -1;
            index = same !== -1 ? same : Math.min(index, ranges.length - 1);
            paint();
            return state();
        },
        step(dir) {
            ranges = collect();
            index = stepMatch(index, ranges.length, dir);
            paint();
            reveal();
            return state();
        },
        clear() {
            query = '';
            ranges = [];
            index = -1;
            paint();
        },
    };
}
