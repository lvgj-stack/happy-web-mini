// A turn's steps fold into one block, placed where the turn began. When the
// person writes while it runs, the block ends there: what the agent does next
// goes into a new block after their message, so the chat reads in the order
// things happened (as the official apps' flat lists do). A "break" is the seq
// of such a message.

/** Whether a decoded message (see app.js toView) is something the person sent that shows in the chat. */
export function isBreak(view) {
    if (view?.kind === 'user') return !!view.text?.trim();
    return view?.kind === 'image' && view.mine === true && !!view.ref;
}

/** Add a break to the sorted list; false when it was already there. */
export function addBreak(breaks, seq) {
    let i = breaks.length;
    while (i > 0 && breaks[i - 1] > seq) i--;
    if (i > 0 && breaks[i - 1] === seq) return false;
    breaks.splice(i, 0, seq);
    return true;
}

/**
 * The index of the block (`{ seq, maxSeq }`, of one turn) that the step at
 * `seq` goes into, or -1 when it opens a new one: a step joins a block only
 * when the person wrote nothing between them. Steps that only close what an
 * earlier one opened (`shows` false: turn-end, tool-call-end, an empty text)
 * never open a block of their own while the turn has one; they go to the
 * nearest block before them.
 */
export function segmentFor(segments, breaks, seq, shows = true) {
    for (let i = 0; i < segments.length; i++) {
        const lo = Math.min(seq, segments[i].seq);
        const hi = Math.max(seq, segments[i].maxSeq);
        if (!breaks.some((b) => b > lo && b < hi)) return i;
    }
    if (shows || segments.length === 0) return -1;
    let best = 0;
    for (let i = 1; i < segments.length; i++) {
        const before = segments[i].seq <= seq;
        const bestBefore = segments[best].seq <= seq;
        if (before ? !bestBefore || segments[i].seq > segments[best].seq : !bestBefore && segments[i].seq < segments[best].seq) best = i;
    }
    return best;
}

/** The person wrote after this block began: whatever the turn does next is not in it. */
export function isCut(block, breaks) {
    return breaks.length > 0 && breaks[breaks.length - 1] > block.seq;
}
