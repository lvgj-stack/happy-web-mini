// The person's own order of computers in the sidebar, kept in this browser.
// Computers they have placed come first in that order; the rest follow by name.

/** The stored order as a list of machine keys; anything unreadable counts as no order. */
export function readHostOrder(raw) {
    try {
        const data = JSON.parse(raw);
        if (data?.v !== 1 || !Array.isArray(data.keys)) return [];
        return [...new Set(data.keys.filter((k) => typeof k === 'string'))];
    } catch {
        return [];
    }
}

/** The string to store for an order. */
export const writeHostOrder = (keys) => JSON.stringify({ v: 1, keys });

/** `machines` ({ key, name }) in the stored order, unplaced ones after it by name then key. */
export function sortHosts(machines, order) {
    const at = new Map(order.map((k, i) => [k, i]));
    return [...machines].sort((a, b) => {
        const x = at.get(a.key), y = at.get(b.key);
        if (x != null || y != null) return (x ?? Infinity) - (y ?? Infinity);
        return a.name.localeCompare(b.name, 'zh') || a.key.localeCompare(b.key);
    });
}

/**
 * The new order after dropping `key` before (or `after`) `target`. `shown`
 * is the keys as the list shows them now; computers that are offline keep
 * their place in the stored order, so they come back where they were.
 */
export function moveHost(order, shown, key, target, after = false) {
    if (key === target || !shown.includes(key) || !shown.includes(target)) return order;
    const full = [...order, ...shown.filter((k) => !order.includes(k))].filter((k) => k !== key);
    full.splice(full.indexOf(target) + (after ? 1 : 0), 0, key);
    return full;
}
