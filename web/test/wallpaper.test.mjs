// node --test: the chat area's background, as kept in localStorage.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    DEFAULT_FADE, readWallpaper, sideFade, removeWallpaperImage, setWallpaperColor, setWallpaperFade, setWallpaperImage, wallpaperStyle,
} from '../wallpaper.js';

const memory = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const IMG = 'data:image/jpeg;base64,/9j/AAAA';

test('nothing saved, or something broken: the default look', () => {
    const s = memory();
    assert.deepEqual(readWallpaper(s), { kind: 'default', color: '', fade: DEFAULT_FADE, image: '' });
    s.setItem('happy.wallpaper', '{oops');
    assert.equal(readWallpaper(s).kind, 'default');
    s.setItem('happy.wallpaper', JSON.stringify({ kind: 'color', color: 'red;background:url(x)' }));
    assert.equal(readWallpaper(s).kind, 'default', 'only #rrggbb is taken as a color');
    s.setItem('happy.wallpaper', JSON.stringify({ kind: 'image' }));
    assert.equal(readWallpaper(s).kind, 'default', 'a picture that is not kept falls back');
});

test('a color, then back to the default', () => {
    const s = memory();
    setWallpaperColor(s, '#e8f1ea');
    assert.deepEqual(readWallpaper(s), { kind: 'color', color: '#E8F1EA', fade: DEFAULT_FADE, image: '' });
    const tinted = wallpaperStyle(readWallpaper(s));
    assert.equal(tinted.main.backgroundColor, '#E8F1EA');
    assert.equal(tinted.side.backgroundColor, '', 'a color tints the chat area alone');
    assert.equal(tinted.app.backgroundImage, '');
    setWallpaperColor(s, '');
    assert.equal(readWallpaper(s).kind, 'default');
    const none = { backgroundColor: '', backgroundImage: '', backgroundSize: '', backgroundPosition: '' };
    assert.deepEqual(wallpaperStyle(readWallpaper(s)), { app: none, side: none, main: none });
});

test('a picture under a veil; it stays kept while a color is picked', () => {
    const s = memory();
    setWallpaperImage(s, IMG);
    setWallpaperFade(s, 0.3);
    let w = readWallpaper(s);
    assert.deepEqual(w, { kind: 'image', color: '', fade: 0.3, image: IMG });
    const style = wallpaperStyle(w);
    assert.equal(style.app.backgroundImage, `url("${IMG}")`, 'one picture spans the window');
    assert.equal(style.main.backgroundColor, 'rgba(252, 252, 250, 0.3)');
    assert.equal(style.side.backgroundColor, 'rgba(242, 243, 239, 0.45)', 'the sidebar a little denser');
    assert.equal(style.main.backgroundImage, '');
    assert.equal(sideFade(0.9), 0.95);
    setWallpaperColor(s, '#F6F1E6');
    w = readWallpaper(s);
    assert.equal(w.kind, 'color');
    assert.equal(w.image, IMG);
    assert.equal(w.fade, 0.3, 'the veil is remembered');
    setWallpaperImage(s); // pick the kept one again
    assert.equal(readWallpaper(s).kind, 'image');
});

test('the veil stays between 0 and 0.95', () => {
    const s = memory();
    setWallpaperFade(s, 2);
    assert.equal(readWallpaper(s).fade, 0.95);
    setWallpaperFade(s, -1);
    assert.equal(readWallpaper(s).fade, 0);
});

test('removing the picture: back to the default when it was showing', () => {
    const s = memory();
    setWallpaperImage(s, IMG);
    removeWallpaperImage(s);
    assert.deepEqual(readWallpaper(s), { kind: 'default', color: '', fade: DEFAULT_FADE, image: '' });
    setWallpaperImage(s, IMG);
    setWallpaperColor(s, '#EEEFEC');
    removeWallpaperImage(s);
    assert.equal(readWallpaper(s).kind, 'color', 'a picked color is left alone');
});

test('only image data URLs are taken', () => {
    assert.throws(() => setWallpaperImage(memory(), 'javascript:alert(1)'));
    assert.throws(() => setWallpaperImage(memory(), 'data:image/svg+xml;base64,AAAA'));
});
