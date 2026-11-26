// Custom stickers for the skins: your own pictures in place of what falls in
// the chat, what flies out when a session is done, and the mark beside a row
// waiting for you. Small PNGs kept in this browser only, never in the repo.

const KEY = 'happy.skin.sticker.';
const MAX_EDGE = 128;
const MAX_CHARS = 200_000;

/** The places a sticker can go, in the order settings shows them. */
export const SLOTS = ['fall', 'done', 'ask'];

const isPng = (d) => typeof d === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(d);

/** Every place's sticker as a PNG data URL, '' where there is none (or what is kept is broken). */
export function readStickers(storage) {
    const out = {};
    for (const slot of SLOTS) {
        const v = storage.getItem(KEY + slot) || '';
        out[slot] = isPng(v) && v.length <= MAX_CHARS ? v : '';
    }
    return out;
}

/** Keep a sticker (a PNG data URL from prepareSticker). Throws on a bad place or picture; a full storage throws as it does. */
export function setSticker(storage, slot, dataUrl) {
    if (!SLOTS.includes(slot)) throw new Error('没有这个贴图位置');
    if (!isPng(dataUrl)) throw new Error('图片格式不对，换成 PNG 或 JPEG 再试');
    if (dataUrl.length > MAX_CHARS) throw new Error('图片太大，换一张简单点的');
    storage.setItem(KEY + slot, dataUrl);
}

export function removeSticker(storage, slot) {
    if (SLOTS.includes(slot)) storage.removeItem(KEY + slot);
}

/** A picked file as a PNG data URL, at most 128px on its longer edge (browser only). */
export async function prepareSticker(file) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error(`读不了「${file.name || '图片'}」，换成 PNG 或 JPEG 再试`);
    }
    try {
        const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png'); // keeps transparency
    } finally {
        bitmap.close();
    }
}
