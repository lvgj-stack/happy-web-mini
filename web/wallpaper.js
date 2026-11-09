// The window's background: a preset or custom color, or a picture of your own
// under a veil of the page color so the text stays readable. Kept per browser.

const KEY = 'happy.wallpaper';
const IMAGE_KEY = 'happy.wallpaper.image'; // kept while a color is picked, so the picture can come back

export const PRESETS = [
    { id: 'default', name: '默认', color: '' },
    { id: 'cream', name: '米黄', color: '#F6F1E6' },
    { id: 'mist', name: '雾灰', color: '#EEEFEC' },
    { id: 'mint', name: '薄荷', color: '#E8F1EA' },
    { id: 'sky', name: '天蓝', color: '#E8EFF6' },
    { id: 'blush', name: '浅粉', color: '#F6ECEC' },
];
export const DEFAULT_FADE = 0.6;
const VEIL = '252, 252, 250'; // --sheet
const SIDE_VEIL = '242, 243, 239'; // --paper

const isColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const isImage = (d) => typeof d === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d);
const clampFade = (f) => (Number.isFinite(f) ? Math.min(0.95, Math.max(0, f)) : DEFAULT_FADE);

/** What is picked: { kind: 'default' | 'color' | 'image', color, fade, image } (image: a data URL or ''). */
export function readWallpaper(storage) {
    let saved = {};
    try { saved = JSON.parse(storage.getItem(KEY) || '{}') || {}; } catch { /* a broken value is the default */ }
    const image = storage.getItem(IMAGE_KEY) || '';
    const w = { kind: 'default', color: '', fade: clampFade(saved.fade), image: isImage(image) ? image : '' };
    if (saved.kind === 'color' && isColor(saved.color)) return { ...w, kind: 'color', color: saved.color.toUpperCase() };
    if (saved.kind === 'image' && w.image) return { ...w, kind: 'image' };
    return w;
}

/** Pick a color ('' is the default look). */
export function setWallpaperColor(storage, color) {
    const { fade } = readWallpaper(storage);
    storage.setItem(KEY, JSON.stringify(isColor(color) ? { kind: 'color', color, fade } : { kind: 'default', fade }));
}

/** Pick a picture (a data URL from prepareWallpaper), or the one already kept when none is given. Throws when storage is full. */
export function setWallpaperImage(storage, image) {
    if (image !== undefined) {
        if (!isImage(image)) throw new Error('图片格式不对');
        storage.setItem(IMAGE_KEY, image);
    }
    storage.setItem(KEY, JSON.stringify({ kind: 'image', fade: readWallpaper(storage).fade }));
}

export function setWallpaperFade(storage, fade) {
    const w = readWallpaper(storage);
    storage.setItem(KEY, JSON.stringify({ kind: w.kind, color: w.color || undefined, fade: clampFade(fade) }));
}

/** Forget the picture; showing it, the default look comes back. */
export function removeWallpaperImage(storage) {
    const w = readWallpaper(storage);
    storage.removeItem(IMAGE_KEY);
    if (w.kind === 'image') storage.setItem(KEY, JSON.stringify({ kind: 'default', fade: w.fade }));
}

const NONE = { backgroundColor: '', backgroundImage: '', backgroundSize: '', backgroundPosition: '' };
const veil = (rgb, alpha) => ({ ...NONE, backgroundColor: `rgba(${rgb}, ${alpha})` });

/**
 * Inline styles for the window (#app), the sidebar and the chat area; empty
 * strings put the stylesheet's look back. A color tints the chat area alone;
 * a picture spans the whole window, under the page color in the chat area and
 * a denser sidebar color, so the two still read apart.
 */
export function wallpaperStyle(w) {
    if (w.kind === 'color') return { app: NONE, side: NONE, main: { ...NONE, backgroundColor: w.color } };
    if (w.kind === 'image') {
        return {
            app: { ...NONE, backgroundImage: `url("${w.image}")`, backgroundSize: 'cover', backgroundPosition: 'center' },
            side: veil(SIDE_VEIL, sideFade(w.fade)),
            main: veil(VEIL, w.fade),
        };
    }
    return { app: NONE, side: NONE, main: NONE };
}

/** The sidebar's veil: a little denser than the chat area's. */
export const sideFade = (fade) => Math.round(Math.min(0.95, fade + 0.15) * 100) / 100;

const MAX_EDGE = 2560;
const MAX_CHARS = 1.5 * 1024 * 1024; // the data URL; localStorage holds about 5 million characters in all

/** A picked file as a JPEG data URL small enough to keep in localStorage (browser only). */
export async function prepareWallpaper(file) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error(`读不了「${file.name || '图片'}」，换成 PNG 或 JPEG 再试`);
    }
    let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    try {
        for (let attempt = 0; attempt < 6; attempt++) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = `rgb(${VEIL})`; // JPEG has no transparency
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const url = canvas.toDataURL('image/jpeg', attempt < 2 ? 0.82 : 0.72);
            if (url.length <= MAX_CHARS) return url;
            if (attempt >= 1) scale *= 0.75;
        }
    } finally {
        bitmap.close();
    }
    throw new Error('图片太大，压缩后还是放不下');
}
