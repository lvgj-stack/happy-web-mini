import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appHeight, fitToViewport } from '../viewport.js';

test('appHeight follows the visual viewport', () => {
    assert.equal(appHeight({ height: 512.4, scale: 1 }), 512);
});

test('appHeight leaves the app alone while pinch-zoomed or without visualViewport', () => {
    assert.equal(appHeight({ height: 300, scale: 2 }), null);
    assert.equal(appHeight(undefined), null);
});

test('fitToViewport sets --app-height and scrolls the page back to the top on resize', () => {
    const listeners = {};
    const vv = { height: 900, scale: 1, addEventListener: (t, f) => { listeners[t] = f; } };
    const props = {};
    const win = {
        visualViewport: vv,
        scrollX: 0,
        scrollY: 0,
        scrollTo(x, y) { this.scrollX = x; this.scrollY = y; },
        document: { documentElement: { style: { setProperty: (k, v) => { props[k] = v; } } } },
    };
    fitToViewport(win);
    assert.equal(props['--app-height'], '900px');

    // keyboard opens: visual viewport shrinks and the browser scrolls the page up
    vv.height = 540;
    win.scrollY = 360;
    listeners.resize();
    assert.equal(props['--app-height'], '540px');
    assert.equal(win.scrollY, 0);
});
