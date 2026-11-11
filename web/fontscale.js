// The chat area's text size: one of a few steps, as a factor on the page's sizes. Kept per browser.
// index.html multiplies the chat's font sizes by --chat-scale; the sidebar, headers and settings stay put.

const KEY = 'happy.chatScale';

export const SCALES = [
    { name: '小', value: 0.9 },
    { name: '标准', value: 1 },
    { name: '大', value: 1.1 },
    { name: '更大', value: 1.25 },
    { name: '特大', value: 1.4 },
];

const isStep = (v) => SCALES.some((s) => s.value === v);

/** The picked step; anything else is 标准 (1). */
export function readChatScale(storage) {
    const v = Number(storage.getItem(KEY));
    return isStep(v) && v > 0 ? v : 1;
}

/** Pick a step; 标准, or a value that is not a step, clears it. */
export function setChatScale(storage, value) {
    if (isStep(value) && value !== 1) storage.setItem(KEY, String(value));
    else storage.removeItem(KEY);
}
