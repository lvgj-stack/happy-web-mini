// Skin effects: an ambient scene behind the chat and small shows at the moments
// that matter (a message sent, a session done, waiting for you, a click on an
// empty spot). Two canvases, both pointer-events: none — one inside <main>
// under its content (z-index -1 in main's own stacking context), one fixed
// over the window. One requestAnimationFrame loop draws both; it pauses while
// the tab is hidden and stops when nothing is left to draw. Browser only:
// nothing here runs until createEffects() is called. Drawings follow the
// skins preview page; every shape is drawn here, no images.

import { blipSpots, createRange, drawRangeParticle, hudArea } from './range.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const PETALS = ['#F4A7B9', '#F7C5D0', '#EE8FA6', '#FBD9E1', '#F9B3C4'];
const LEAVES = ['#8DB255', '#B8C95A', '#D9A441', '#7FA65A'];
const WINGS = ['#F2A03D', '#F7D25C', '#9FC6E8', '#F0F0E8'];
const GOLD = ['#F7D25C', '#FFF3C4', '#F2A03D'];
const SEA_GLOW = ['#3FD0C9', '#8FE3F0', '#B4FFF0'];
const STARLIGHT = ['#F5C451', '#FFF6D8', '#9D8CFF'];
const CONFETTI = ['#E8553B', '#F2B233', '#3FA66B', '#3B7DD8', '#1E2430'];
const CLOUD = ['..XXX....', '.XXXXXX..', 'XXXXXXXXX', '.XXXXXXX.'];
const MAX_PARTICLES = 220;

/** 旷野's sky, ridges and grass for each time of day. */
const SCENE = {
    day: {
        sky: ['rgba(190, 222, 236, .55)', 'rgba(190, 222, 236, 0)'], ridge: ['rgba(140, 170, 180, .22)', 'rgba(120, 160, 130, .2)', 'rgba(110, 150, 95, .18)'],
        puff: 'rgba(255, 255, 255, .9)', bird: 'rgba(60, 70, 60, .5)', wind: 'rgba(130, 150, 110, .6)', tower: 'rgba(110, 140, 120, .4)',
        grass: ['rgba(127, 166, 90, .4)', 'rgba(152, 181, 92, .36)', 'rgba(104, 140, 74, .34)', 'rgba(184, 201, 90, .32)'],
    },
    dusk: {
        sky: ['rgba(242, 160, 110, .5)', 'rgba(248, 210, 170, 0)'], ridge: ['rgba(170, 120, 140, .2)', 'rgba(140, 100, 110, .22)', 'rgba(110, 90, 80, .22)'],
        puff: 'rgba(252, 224, 214, .9)', bird: 'rgba(70, 45, 40, .55)', wind: 'rgba(180, 140, 110, .6)', tower: 'rgba(120, 85, 90, .42)',
        grass: ['rgba(150, 140, 80, .4)', 'rgba(170, 150, 85, .36)', 'rgba(120, 115, 70, .36)', 'rgba(190, 160, 90, .32)'],
    },
    night: {
        sky: ['rgba(6, 12, 22, .7)', 'rgba(6, 12, 22, 0)'], ridge: ['rgba(40, 55, 75, .5)', 'rgba(28, 40, 55, .6)', 'rgba(20, 30, 38, .7)'],
        puff: 'rgba(120, 135, 160, .25)', bird: '', wind: 'rgba(94, 115, 133, .6)', tower: 'rgba(30, 42, 56, .95)',
        grass: ['rgba(50, 85, 62, .55)', 'rgba(62, 98, 70, .5)', 'rgba(40, 70, 52, .55)', 'rgba(75, 105, 70, .45)'],
    },
};

// ---------- drawing ----------

function drawPetal(c, x, y, s, rot, flip, col, a) {
    c.save(); c.translate(x, y); c.rotate(rot); c.scale(1, flip); c.globalAlpha = a; c.fillStyle = col;
    c.beginPath(); c.moveTo(0, -s); c.bezierCurveTo(s * .95, -s * .55, s * .7, s * .7, 0, s); c.bezierCurveTo(-s * .7, s * .7, -s * .95, -s * .55, 0, -s); c.fill();
    c.restore();
}

function drawLeaf(c, x, y, s, rot, flip, col, a) {
    c.save(); c.translate(x, y); c.rotate(rot); c.scale(flip, 1); c.globalAlpha = a; c.fillStyle = col;
    c.beginPath(); c.moveTo(0, -s); c.quadraticCurveTo(s * .6, 0, 0, s); c.quadraticCurveTo(-s * .6, 0, 0, -s); c.fill();
    c.strokeStyle = 'rgba(46, 51, 38, .25)'; c.lineWidth = .6; c.beginPath(); c.moveTo(0, -s * .8); c.lineTo(0, s * .9); c.stroke();
    c.restore();
}

function drawSpark(c, x, y, s, col, a) {
    c.save(); c.globalAlpha = a; c.fillStyle = col; c.beginPath();
    c.moveTo(x, y - s); c.quadraticCurveTo(x, y, x + s, y); c.quadraticCurveTo(x, y, x, y + s); c.quadraticCurveTo(x, y, x - s, y); c.quadraticCurveTo(x, y, x, y - s);
    c.fill(); c.restore();
}

/** A gust: a wavy line whose head moves along (vx, vy), trailing behind it. */
function drawWind(c, p, a) {
    const v = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / v, uy = p.vy / v;
    c.save(); c.globalAlpha = a; c.strokeStyle = p.col; c.lineWidth = 1.4; c.lineCap = 'round'; c.beginPath();
    for (let i = 0; i <= p.len; i += 4) {
        const w = Math.sin(i * .08 + p.ph) * 6 * (i / p.len), x = p.x - ux * i - uy * w, y = p.y - uy * i + ux * w;
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.stroke(); c.restore();
}

function drawButterfly(c, p, k) {
    const x = p.x + Math.sin(p.life * 2.2 + p.ph) * 14, y = p.y + Math.sin(p.life * 5 + p.ph) * 6, flap = .25 + .75 * Math.abs(Math.sin(p.life * 16));
    c.save(); c.translate(x, y); c.rotate(Math.sin(p.life * 2.2 + p.ph) * .3); c.globalAlpha = Math.min(1, (1 - k) * 3);
    for (const side of [-1, 1]) {
        c.save(); c.scale(side * flap, 1); c.fillStyle = p.col;
        c.beginPath(); c.ellipse(3.6, -2.2, 4.2, 3, -.5, 0, 7); c.fill();
        c.beginPath(); c.ellipse(2.8, 2.2, 2.8, 2.2, .5, 0, 7); c.fill();
        c.restore();
    }
    c.fillStyle = '#3A3226'; c.fillRect(-.6, -3.6, 1.2, 7.2); c.restore();
}

function glowDot(c, x, y, r, col, a, blur = 10) {
    c.save(); c.globalAlpha = a; c.fillStyle = col; c.shadowColor = col; c.shadowBlur = blur;
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.restore();
}

/** A wooden chest that pops up, opens and lets out a beam of light. */
function drawChest(c, p, k) {
    const pop = k < .1 ? .4 + 6 * k : 1, open = Math.min(1, Math.max(0, (k - .22) / .12)), al = k > .82 ? (1 - k) / .18 : 1;
    c.save(); c.translate(p.x, p.y); c.scale(pop * 1.4, pop * 1.4); c.globalAlpha = al;
    if (open > 0) {
        const g = c.createLinearGradient(0, -8, 0, -46);
        g.addColorStop(0, `rgba(255, 226, 140, ${.75 * open})`); g.addColorStop(1, 'rgba(255, 226, 140, 0)');
        c.fillStyle = g; c.beginPath(); c.moveTo(-9, -7); c.lineTo(-20, -46); c.lineTo(20, -46); c.lineTo(9, -7); c.fill();
    }
    c.fillStyle = '#8A5A2B'; c.fillRect(-11, -6, 22, 13);
    c.fillStyle = '#6E4520'; c.fillRect(-11, -1, 22, 2); c.fillRect(-7, -6, 2, 13); c.fillRect(5, -6, 2, 13);
    c.save(); c.translate(-11, -6); c.rotate(-open * 1.9); c.fillStyle = '#9C6833';
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -5); c.quadraticCurveTo(11, -11, 22, -5); c.lineTo(22, 0); c.fill();
    c.fillStyle = '#6E4520'; c.fillRect(4, -8, 2, 8); c.fillRect(16, -8, 2, 8); c.restore();
    c.fillStyle = '#E6B84A'; c.fillRect(-2, -3, 4, 5);
    c.restore();
}

/** A shooting star: a bright head and a tail behind it along its motion. */
function drawStreak(c, x, y, vx, vy, len, col, a) {
    const v = Math.hypot(vx, vy) || 1, tx = x - vx / v * len, ty = y - vy / v * len;
    const g = c.createLinearGradient(x, y, tx, ty);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    c.save(); c.globalAlpha = a; c.strokeStyle = g; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x, y); c.lineTo(tx, ty); c.stroke();
    c.fillStyle = '#fff'; c.shadowColor = col; c.shadowBlur = 10; c.beginPath(); c.arc(x, y, 2, 0, 7); c.fill(); c.restore();
}

function drawBubble(c, x, y, r, a) {
    c.globalAlpha = a * .6; c.strokeStyle = '#8FE3F0'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke();
    c.globalAlpha = a * .75; c.fillStyle = '#CFF6FB'; c.beginPath(); c.arc(x - r * .35, y - r * .35, r * .25, 0, 7); c.fill();
    c.globalAlpha = 1;
}

/** A sticker of your own, `s` px on its longer edge. */
function drawSprite(c, img, x, y, s, rot, a) {
    const ratio = (img.naturalWidth || img.width) / (img.naturalHeight || img.height) || 1;
    const w = ratio >= 1 ? s : s * ratio, h = ratio >= 1 ? s / ratio : s;
    c.save(); c.globalAlpha = a; c.translate(x, y); c.rotate(rot); c.drawImage(img, -w / 2, -h / 2, w, h); c.restore();
}

/** One event particle; returns false once it is gone. */
function drawParticle(c, p, dt) {
    if (p.delay > 0) { p.delay -= dt; return true; }
    p.life += dt;
    if (p.life >= p.max) return false;
    p.vy += p.ay * dt;
    const d = Math.max(0, 1 - p.drag * dt);
    p.vx *= d; p.vy *= d; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    const k = p.life / p.max, fade = 1 - k * k;
    switch (p.k) {
    case 'petal': drawPetal(c, p.x, p.y, p.s, p.rot, .4 + .6 * Math.abs(Math.sin(p.life * 7)), p.col, fade); break;
    case 'leaf': drawLeaf(c, p.x, p.y, p.s, p.rot, Math.sin(p.life * 8), p.col, fade); break;
    case 'spark': drawSpark(c, p.x, p.y, p.s * (1 - k * .5), p.col, fade); break;
    case 'wind': drawWind(c, p, Math.sin(Math.PI * k) * .85); break;
    case 'chest': drawChest(c, p, k); break;
    case 'butterfly': drawButterfly(c, p, k); break;
    case 'firefly': glowDot(c, p.x + Math.sin(p.life * 2 + p.ph) * 10, p.y, 2.2, '#E2F58A', Math.min(1, (1 - k) * 3) * (.35 + .65 * Math.abs(Math.sin(p.life * 3 + p.ph))), 12); break;
    case 'bubble': drawBubble(c, p.x + Math.sin(p.life * 12) * 2, p.y, p.r, fade * 1.4); break;
    case 'glow': glowDot(c, p.x + Math.sin(p.life * 3) * 6, p.y, p.r, p.col, Math.sin(Math.PI * k), 8); break;
    case 'streak': drawStreak(c, p.x, p.y, p.vx, p.vy, p.len, p.col, Math.min(1, 4 * (1 - k))); break;
    case 'square': {
        c.save(); c.globalAlpha = k > .75 ? (1 - k) * 4 : 1; c.fillStyle = p.col;
        c.translate(Math.round(p.x), Math.round(p.y)); c.rotate(Math.round(p.rot / 1.5708) * 1.5708);
        c.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); c.restore();
        break;
    }
    case 'text': c.globalAlpha = fade; c.fillStyle = p.col; c.font = 'bold 14px ui-monospace, Menlo, Consolas, monospace'; c.fillText(p.text, Math.round(p.x), Math.round(p.y)); c.globalAlpha = 1; break;
    case 'sprite': drawSprite(c, p.img, p.x, p.y, p.s, p.rot, fade); break;
    case 'dot': c.globalAlpha = fade; c.fillStyle = p.col; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill(); c.globalAlpha = 1; break;
    case 'ring': {
        const e = 1 - Math.pow(1 - k, 3);
        c.globalAlpha = (1 - k) * .8; c.strokeStyle = p.col; c.lineWidth = 2 * (1 - k) + .5;
        c.beginPath(); c.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * e, 0, 7); c.stroke(); c.globalAlpha = 1;
        break;
    }
    default: drawRangeParticle(c, p, k); // 靶场's own: flash, tracer, casing, hit, shard, hole, dmg
    }
    return true;
}

// ---------- the module ----------

/**
 * Starts the effects for the page.
 * @param {{ main: HTMLElement }} opts the chat area; the ambient scene draws behind its content
 * @returns {{ setSkin(id: string, motion: string, time: string, opts?: { gun?: boolean }): void, send(el: Element): void,
 *   done(el: Element, name?: string): void, click(x: number, y: number): void, hurt(): void, setOnline(on: boolean): void,
 *   setStickers(s: object): void, wake(): void }}
 */
export function createEffects({ main }) {
    const amb = document.createElement('canvas');
    amb.className = 'fx-ambient';
    amb.setAttribute('aria-hidden', 'true');
    main.prepend(amb);
    const fx = document.createElement('canvas');
    fx.className = 'fx-events';
    fx.setAttribute('aria-hidden', 'true');
    document.body.append(fx);
    const actx = amb.getContext('2d'), fctx = fx.getContext('2d');

    let skin = 'moss', motion = 'full', time = 'day';
    let MW = 0, MH = 0, W = 0, H = 0, dpr = 1;
    let raf = 0, last = 0, now = 0, broken = false;
    let parts = [];               // event particles, in window coordinates
    let scene = {};               // the ambient scene's own state
    let stickers = { fall: null, done: null, ask: null }; // loaded images of your own, or null
    const trails = new Map();     // fairy trails by row id
    const range = createRange();  // 靶场's magazine, health, targets and feed
    let gun = true;               // 靶场 shows its weapon
    let rview = null;             // 靶场's view of the page this frame (rangeView)
    let blips = [], blipsAt = -9; // 靶场's radar blips, looked up once a second

    function fit() {
        // The window can move to a screen with another pixel ratio without resizing: reallocate then too.
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const moved = ratio !== dpr;
        dpr = ratio;
        const r = main.getBoundingClientRect();
        if (moved || Math.round(r.width) !== MW || Math.round(r.height) !== MH) {
            MW = Math.round(r.width); MH = Math.round(r.height);
            amb.width = MW * dpr; amb.height = MH * dpr;
            reseed();
        }
        if (moved || window.innerWidth !== W || window.innerHeight !== H) {
            W = window.innerWidth; H = window.innerHeight;
            fx.width = W * dpr; fx.height = H * dpr;
        }
    }

    const ambientOn = () => motion === 'full' && (skin !== 'moss' || !!stickers.fall) && MW > 0 && MH > 0;
    /** The sidebar list's visible box, which waiting-row drawings stay inside (not over its header or off its scroll). */
    const listBox = () => document.getElementById('list')?.getBoundingClientRect();
    /** Waiting rows to draw by: inside the list's visible box only, so a hidden or scrolled-away row neither draws nor keeps the loop running. */
    const waitingRows = () => {
        if (motion === 'off' || (skin !== 'wild' && skin !== 'range' && !stickers.ask)) return [];
        const box = listBox();
        if (!box?.width || !box.height) return [];
        return [...document.querySelectorAll('#list .row.asking')].filter((row) => {
            const r = row.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.bottom > box.top && r.top < box.bottom;
        });
    };

    function wake() {
        if (raf || document.hidden) return;
        if (!ambientOn() && !parts.length && !waitingRows().length && !(skin === 'range' && range.busy())) { clear(); return; }
        last = performance.now();
        raf = requestAnimationFrame(frame);
    }

    function clear() {
        actx.setTransform(1, 0, 0, 1, 0, 0); actx.clearRect(0, 0, amb.width, amb.height);
        fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, fx.width, fx.height);
    }

    function frame(ts) {
        raf = 0;
        if (document.hidden) return;
        const dt = Math.min(.05, (ts - last) / 1000);
        last = ts; now += dt;
        fit();
        if (skin === 'range') { range.tick(dt); rview = rangeView(); }
        actx.setTransform(dpr, 0, 0, dpr, 0, 0); actx.clearRect(0, 0, MW, MH);
        // A scene that throws must not take the event shows down with it: log once, draw the rest.
        if (ambientOn()) {
            actx.save();
            try {
                SCENES[skin]?.(actx, dt, now);
            } catch (e) {
                // drop the broken scene so it does not throw again every frame; the stickers still fall
                scene = { sprites: scene.sprites };
                if (!broken) console.error('effects: ambient scene failed', e);
                broken = true;
            }
            actx.restore(); // also unwinds a save() the scene left open when it threw
            if (stickers.fall) fallingStickers(actx, dt);
        }
        fctx.setTransform(dpr, 0, 0, dpr, 0, 0); fctx.clearRect(0, 0, W, H);
        parts = parts.filter((p) => drawParticle(fctx, p, dt));
        const showing = skin === 'range' && motion !== 'off' && range.overlay(fctx, dt, rview);
        const rows = waitingRows();
        if (rows.length) {
            // clipped to the list, so a row half under the sidebar's header does not draw over it
            const box = listBox();
            fctx.save(); fctx.beginPath(); fctx.rect(box.left, box.top, box.width, box.height); fctx.clip();
            for (const row of rows) (stickers.ask ? askSticker : skin === 'range' ? lockOn : fairy)(fctx, row);
            fctx.restore();
        }
        if (!rows.length) { trails.clear(); range.clearLocks(); }
        if (ambientOn() || parts.length || rows.length || showing) raf = requestAnimationFrame(frame);
        else clear();
    }

    // ---------- ambient scenes ----------

    function petal(top) {
        return { x: rnd(-10, MW + 10), y: top ? rnd(-40, -10) : rnd(0, MH), vx: rnd(-8, 8), vy: rnd(16, 34), rot: rnd(0, 6.3), vr: rnd(-1.4, 1.4), s: rnd(4, 7.5), ph: rnd(0, 6.3), phs: rnd(1, 2.4), col: pick(PETALS) };
    }
    function leaf(left) {
        return { x: left ? rnd(-60, -10) : rnd(0, MW), y: rnd(MH * .15, MH * .75), vx: rnd(28, 60), ph: rnd(0, 6.3), rot: rnd(0, 6.3), vr: rnd(-2, 2), s: rnd(5, 8), col: pick(LEAVES) };
    }
    const horizon = () => Math.max(90, Math.min(MH * .3, 260));

    /** seed(), but a failure leaves an empty scene (logged) instead of stopping the loop. */
    function reseed() {
        try {
            seed();
        } catch (e) {
            scene = {};
            if (!broken) console.error('effects: ambient scene failed', e);
            broken = true;
        }
    }

    function seed() {
        scene = {};
        if (!MW || !MH) return;
        const area = MW * MH;
        if (skin === 'sakura') scene.petals = Array.from({ length: Math.round(Math.min(26, Math.max(10, area / 40000))) }, () => petal(false));
        if (skin === 'wild') {
            const hz = horizon();
            scene.grass = [];
            for (let x = -4; x < MW + 6; x += rnd(7, 15)) scene.grass.push({ x, h: rnd(22, 56), w: rnd(2.6, 4.6), ph: rnd(0, 6.3), c: Math.floor(rnd(0, 4)) });
            scene.leaves = Array.from({ length: 5 }, () => leaf(false));
            scene.ridges = [[34, 30, .011], [20, 22, .019], [8, 12, .033]].map(([base, amp, f]) => {
                const ph = rnd(0, 9), pts = [];
                for (let x = 0; x <= MW + 8; x += 6) pts.push([x, hz - base - amp * (.55 * Math.sin(x * f + ph) + .3 * Math.sin(x * f * 2.3 + ph * 1.7) + .15 * Math.sin(x * f * 5.1))]);
                return pts;
            });
            scene.puffs = Array.from({ length: 3 }, () => ({ x: rnd(0, MW), y: rnd(14, hz - 50), s: rnd(.7, 1.2), sp: rnd(4, 9) }));
            scene.stars = Array.from({ length: Math.round(MW / 9) }, () => ({ x: rnd(0, MW), y: rnd(4, hz - 10), s: rnd(.4, 1.3), sp: rnd(.6, 2), ph: rnd(0, 6.3) }));
            scene.flies = Array.from({ length: 14 }, () => ({ x: rnd(0, MW), y: rnd(hz, MH - 30), vx: rnd(-10, 10), vy: rnd(-10, 10), ph: rnd(0, 6.3) }));
            scene.winds = []; scene.birds = []; scene.gust = 0;
            scene.nextWind = now + 1; scene.nextBirds = now + 3;
        }
        if (skin === 'sea') scene.bubbles = Array.from({ length: Math.round(Math.min(30, Math.max(12, area / 30000))) }, () => bubble(false));
        if (skin === 'star') {
            scene.stars = Array.from({ length: Math.round(Math.min(400, area / 2600)) }, () => ({ x: rnd(0, MW), y: rnd(0, MH), s: rnd(.5, 1.6), sp: rnd(.6, 2.2), ph: rnd(0, 6.3) }));
            scene.shoots = []; scene.nextShoot = now + 2;
        }
        if (skin === 'pixel') {
            const n = Math.max(3, Math.round(MH / 180));
            scene.clouds = Array.from({ length: n }, (_, i) => cloud(rnd(-40, MW), 30 + i * (MH - 120) / n));
        }
        if (skin === 'range') range.seed(MW, MH);
        scene.sprites = Array.from({ length: 9 }, () => sprite(false));
    }

    /**
     * 靶场's view of the page: the free part of the chat area (under its header,
     * over the composer, left of the docked links panel), whether the HUD and the
     * weapon show (not on the settings or usage page; the weapon needs room), and
     * the radar's blips from the sidebar rows.
     */
    function rangeView() {
        const m = main.getBoundingClientRect();
        const shown = (el) => (el && el.offsetParent !== null ? el.getBoundingClientRect() : null);
        const links = document.getElementById('links');
        const area = hudArea({
            main: m,
            head: shown(document.getElementById('chat-head')),
            composer: shown(document.getElementById('composer')) ?? shown(document.getElementById('readonly')),
            links: links && !links.classList.contains('open') ? shown(links) : null,
        });
        if (now - blipsAt > 1 || now < blipsAt) {
            blipsAt = now;
            blips = blipSpots([...document.querySelectorAll('#list .row')].map((r) => ({
                id: r.dataset.id ?? '', status: r.classList.contains('asking') ? 'waiting' : r.classList.contains('busy') ? 'working' : 'idle',
            })));
        }
        const page = document.body.matches('.in-settings, .in-usage');
        return { ...area, left: m.left, y0: m.top, hud: !page, gun: gun && MW >= 520, blips, winW: W, winH: H };
    }

    function shards(x, y, n, col) {
        for (let i = 0; i < n; i++) { const a = rnd(0, 6.3), v = rnd(120, 320); emit({ k: 'shard', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 600, drag: 2, col, max: rnd(.18, .35) }); }
    }

    const lockOn = (c, row) => range.lockOn(c, row, now);

    function bubble(bottom) { return { x: rnd(0, MW), y: bottom ? MH + rnd(5, 40) : rnd(0, MH), r: rnd(1.5, 5), vy: rnd(-14, -36), ph: rnd(0, 6.3) }; }
    /** A pixel cloud on its own lane: `lane` stays put, each lap only varies around it. */
    function cloud(x, lane) { return { x, lane, y: lane + rnd(-10, 10), sp: rnd(5, 12), b: pick([4, 5, 6]) }; }
    function sprite(top) { return { x: rnd(0, MW), y: top ? -20 : rnd(0, MH), vy: rnd(14, 30), ph: rnd(0, 6.3), rot: rnd(-.6, .6), vr: rnd(-.8, .8), s: rnd(16, 24) }; }

    function sea(c, dt, t) {
        for (let i = 0; i < 3; i++) {
            const x0 = MW * (.12 + .32 * i) + Math.sin(t * .35 + i * 2) * 26;
            const g = c.createLinearGradient(0, 0, 0, MH);
            g.addColorStop(0, 'rgba(143, 227, 240, .08)'); g.addColorStop(1, 'rgba(143, 227, 240, 0)');
            c.fillStyle = g; c.beginPath(); c.moveTo(x0 - 14, 0); c.lineTo(x0 + 26, 0); c.lineTo(x0 + 150, MH); c.lineTo(x0 + 60, MH); c.fill();
        }
        if (stickers.fall) return;
        for (const p of scene.bubbles ?? []) {
            p.ph += dt * 2; p.y += p.vy * dt; p.x += Math.sin(p.ph) * 10 * dt;
            if (p.y < -10) Object.assign(p, bubble(true));
            drawBubble(c, p.x, p.y, p.r, .9);
        }
    }

    function star(c, dt, t) {
        if (!scene.stars) return;
        c.fillStyle = '#FFF6D8';
        for (const s of scene.stars ?? []) { c.globalAlpha = .15 + .7 * Math.abs(Math.sin(t * s.sp + s.ph)); c.beginPath(); c.arc(s.x, s.y, s.s, 0, 7); c.fill(); }
        c.globalAlpha = 1;
        if (t > scene.nextShoot) {
            scene.shoots.push({ x: rnd(MW * .1, MW * .7), y: rnd(-10, MH * .3), vx: rnd(260, 380), vy: rnd(90, 150), life: 0, max: .9 });
            scene.nextShoot = t + rnd(5, 10);
        }
        scene.shoots = scene.shoots.filter((p) => (p.life += dt) < p.max);
        for (const p of scene.shoots) { p.x += p.vx * dt; p.y += p.vy * dt; drawStreak(c, p.x, p.y, p.vx, p.vy, 60, '#FFF6D8', Math.sin(Math.PI * p.life / p.max)); }
    }

    function pixel(c, dt) {
        if (stickers.fall) return;
        for (const k of scene.clouds ?? []) {
            k.x += k.sp * dt;
            if (k.x > MW + 10) Object.assign(k, cloud(-k.b * 10, k.lane));
            const x0 = Math.round(k.x / k.b) * k.b, y0 = Math.round(k.y / k.b) * k.b;
            // a blocky drop shadow first, so a white cloud reads on the pale sky
            for (const [col, off] of [['rgba(110, 150, 180, .35)', k.b], ['#FFFFFF', 0]]) {
                c.fillStyle = col;
                CLOUD.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === 'X') c.fillRect(x0 + i * k.b + off, y0 + j * k.b + off, k.b, k.b); });
            }
        }
    }

    /** Your own sticker drifting down, in place of the skin's own small falling things. */
    function fallingStickers(c, dt) {
        for (const p of scene.sprites ?? []) {
            p.ph += dt * 1.6; p.y += p.vy * dt; p.x += Math.sin(p.ph) * 14 * dt; p.rot += p.vr * dt;
            if (p.y > MH + 20) Object.assign(p, sprite(true));
            drawSprite(c, stickers.fall, p.x, p.y, p.s, p.rot, .9);
        }
    }

    function sakura(c, dt) {
        if (stickers.fall) return;
        for (const p of scene.petals ?? []) {
            p.ph += p.phs * dt; p.x += (p.vx + Math.sin(p.ph) * 16) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
            if (p.y > MH + 12) Object.assign(p, petal(true));
            drawPetal(c, p.x, p.y, p.s, p.rot, .45 + .55 * Math.abs(Math.sin(p.ph)), p.col, .7);
        }
    }

    function wild(c, dt, t) {
        if (!scene.grass) return;
        const sc = SCENE[time] ?? SCENE.day, hz = horizon();
        const sky = c.createLinearGradient(0, 0, 0, hz + 30);
        sky.addColorStop(0, sc.sky[0]); sky.addColorStop(1, sc.sky[1]);
        c.fillStyle = sky; c.fillRect(0, 0, MW, hz + 30);
        if (time === 'night') {
            c.fillStyle = '#FFF6D8';
            for (const s of scene.stars) { c.globalAlpha = .25 + .75 * Math.abs(Math.sin(t * s.sp + s.ph)); c.beginPath(); c.arc(s.x, s.y, s.s, 0, 7); c.fill(); }
            c.globalAlpha = 1;
            glowDot(c, MW * .82, hz * .32, 10, '#F4EBC8', 1, 18);
            c.fillStyle = 'rgba(14, 22, 32, .92)'; c.beginPath(); c.arc(MW * .82 + 4, hz * .32 - 3, 8.5, 0, 7); c.fill();
        } else if (time === 'dusk') {
            const sun = c.createRadialGradient(MW * .7, hz - 6, 0, MW * .7, hz - 6, 46);
            sun.addColorStop(0, 'rgba(255, 214, 150, .9)'); sun.addColorStop(.35, 'rgba(255, 190, 120, .5)'); sun.addColorStop(1, 'rgba(255, 170, 110, 0)');
            c.fillStyle = sun; c.beginPath(); c.arc(MW * .7, hz - 6, 46, 0, 7); c.fill();
        }
        for (const q of scene.puffs) {
            q.x += q.sp * dt;
            if (q.x > MW + 60) { q.x = -60; q.y = rnd(14, hz - 50); }
            c.fillStyle = sc.puff; c.beginPath();
            for (const [dx, dy, r] of [[0, 0, 10], [12, -5, 12], [25, 0, 9], [12, 3, 10]]) { c.moveTo(q.x + dx * q.s + r * q.s, q.y + dy * q.s); c.arc(q.x + dx * q.s, q.y + dy * q.s, r * q.s, 0, 7); }
            c.fill();
        }
        // An old tower on the far ridge; its window is lit at night
        const tx = MW * .2, pt = scene.ridges[0][Math.round(tx / 6)] ?? [tx, hz - 40], ty = pt[1] + 3;
        c.fillStyle = sc.tower; c.beginPath();
        c.moveTo(tx - 6, ty); c.lineTo(tx - 4, ty - 34); c.lineTo(tx - 6.5, ty - 36); c.lineTo(tx - 6.5, ty - 40); c.lineTo(tx + 6.5, ty - 40);
        c.lineTo(tx + 6.5, ty - 36); c.lineTo(tx + 4, ty - 34); c.lineTo(tx + 6, ty); c.fill();
        c.beginPath(); c.moveTo(tx - 5, ty - 40); c.lineTo(tx, ty - 52); c.lineTo(tx + 5, ty - 40); c.fill();
        if (time === 'night') glowDot(c, tx, ty - 37, 1.6, '#F7D27A', .7 + .3 * Math.sin(t * 3), 12);
        scene.ridges.forEach((pts, i) => {
            // each ridge fades out at its foot, so the hills melt into the page instead of ending on a line
            const foot = c.createLinearGradient(0, hz - 70, 0, hz + 2);
            foot.addColorStop(0, sc.ridge[i]); foot.addColorStop(.6, sc.ridge[i]); foot.addColorStop(1, sc.ridge[i].replace(/[\d.]+\)$/, '0)'));
            c.fillStyle = foot; c.beginPath(); c.moveTo(0, hz + 2);
            for (const [x, y] of pts) c.lineTo(x, y);
            c.lineTo(MW + 8, hz + 2); c.closePath(); c.fill();
        });
        // Birds by day and dusk: a small flock in a loose V
        if (sc.bird && t > scene.nextBirds) {
            const n = Math.floor(rnd(3, 6)), y0 = rnd(16, hz - 40), sp = rnd(34, 52);
            for (let i = 0; i < n; i++) scene.birds.push({ x: -20 - i * 13, y: y0 + Math.abs(i - (n >> 1)) * 6 * (i % 2 ? 1 : -.4), sp, ph: rnd(0, 6.3) });
            scene.nextBirds = t + rnd(10, 18);
        }
        scene.birds = scene.birds.filter((b) => b.x < MW + 30);
        if (sc.bird) {
            c.strokeStyle = sc.bird; c.lineWidth = 1.3; c.lineCap = 'round';
            for (const b of scene.birds) {
                b.x += b.sp * dt;
                const w = Math.sin(t * 9 + b.ph) * 3.2;
                c.beginPath(); c.moveTo(b.x - 5, b.y - w); c.quadraticCurveTo(b.x - 2, b.y - 1, b.x, b.y); c.quadraticCurveTo(b.x + 2, b.y - 1, b.x + 5, b.y - w); c.stroke();
            }
        }
        // Wind: a gust now and then bends the grass and hurries the leaves
        if (t > scene.nextWind) {
            scene.winds.push({ x: -20, y: rnd(hz + 20, MH * .75), vx: rnd(200, 280), vy: rnd(-12, 12), len: rnd(70, 120), ph: rnd(0, 6.3), col: sc.wind, life: 0, max: (MW + 160) / 220 });
            scene.nextWind = t + rnd(4, 8);
        }
        scene.gust = Math.max(0, scene.gust - dt * 1.2);
        let gust = scene.gust;
        scene.winds = scene.winds.filter((w) => (w.life += dt) < w.max);
        for (const w of scene.winds) {
            w.x += w.vx * dt; w.y += w.vy * dt;
            const a = Math.sin(Math.PI * w.life / w.max);
            gust += a * .7;
            drawWind(c, w, a * .7);
        }
        for (const p of stickers.fall ? [] : scene.leaves) {
            p.ph += dt * 2; p.x += p.vx * (1 + gust * 1.6) * dt; p.y += Math.sin(p.ph) * 14 * dt; p.rot += p.vr * (1 + gust) * dt;
            if (p.x > MW + 20) Object.assign(p, leaf(true));
            drawLeaf(c, p.x, p.y, p.s, p.rot, Math.sin(p.ph * 1.3), p.col, time === 'night' ? .3 : .8);
        }
        if (time === 'night') {
            for (const f of scene.flies) {
                f.vx += rnd(-40, 40) * dt; f.vy += rnd(-40, 40) * dt;
                const v = Math.hypot(f.vx, f.vy);
                if (v > 18) { f.vx *= 18 / v; f.vy *= 18 / v; }
                f.x += f.vx * dt; f.y += f.vy * dt;
                if (f.x < 0 || f.x > MW) f.vx *= -1;
                if (f.y < hz || f.y > MH - 20) f.vy *= -1;
                glowDot(c, f.x, f.y, 1.8, '#E2F58A', .2 + .8 * Math.max(0, Math.sin(t * 1.6 + f.ph)));
            }
        }
        for (const b of scene.grass) {
            const lean = (Math.sin(t * 1.4 + b.x * .025 + b.ph * .2) * .35 + .45 + gust) * b.h * .28;
            c.fillStyle = sc.grass[b.c]; c.beginPath(); c.moveTo(b.x - b.w, MH);
            c.quadraticCurveTo(b.x + lean * .2, MH - b.h * .55, b.x + lean, MH - b.h);
            c.quadraticCurveTo(b.x + b.w * .5 + lean * .3, MH - b.h * .5, b.x + b.w, MH); c.fill();
        }
    }

    // ---------- event shows ----------

    function emit(p) {
        if (parts.length >= MAX_PARTICLES) return;
        parts.push({ life: 0, max: 1, vx: 0, vy: 0, ay: 0, drag: 0, rot: 0, vr: 0, delay: 0, ...p });
    }

    /** The middle of an element on screen, or null when it is not shown. */
    function center(el) {
        const r = el?.getBoundingClientRect();
        if (!r || !r.width || !r.height || r.bottom < 0 || r.top > window.innerHeight) return null;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
    }

    function critters(x, y, butterflies, fireflies, delay = 0) {
        if (time === 'night') {
            for (let i = 0; i < fireflies; i++) emit({ k: 'firefly', x: x + rnd(-8, 8), y: y + rnd(-6, 6), vx: rnd(-30, 50), vy: rnd(-20, -50), ph: rnd(0, 6.3), max: rnd(2.2, 3.2), delay: delay + rnd(0, .4) });
        } else {
            for (let i = 0; i < butterflies; i++) emit({ k: 'butterfly', x, y, vx: rnd(40, 80) * (Math.random() < .3 ? -1 : 1), vy: rnd(-45, -75), ph: rnd(0, 6.3), col: pick(WINGS), max: rnd(2.6, 3.4), delay: delay + i * .15 });
        }
    }

    function sparks(x, y, n, cols, spread = [0, 6.3]) {
        for (let i = 0; i < n; i++) {
            const a = rnd(spread[0], spread[1]), v = rnd(40, 120);
            emit({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 2.3, s: rnd(2, 4.5), col: pick(cols), max: rnd(.7, 1.2) });
        }
    }

    /** A waiting row in 旷野: a little glowing sprite circles it, trailing light. */
    function fairy(c, row) {
        const r = row.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > H) return;
        const id = row.dataset.id ?? '';
        const a = now * 2.2 + (id.length % 7), x = r.left + r.width / 2 + Math.cos(a) * (r.width / 2 - 10), y = r.top + r.height / 2 + Math.sin(a) * (r.height / 2 + 4);
        const trail = trails.get(id) ?? [];
        trail.push([x, y]);
        if (trail.length > 14) trail.shift();
        trails.set(id, trail);
        trail.forEach(([tx, ty], i) => { c.globalAlpha = i / trail.length * .5; c.fillStyle = '#BFF3FF'; c.beginPath(); c.arc(tx, ty, 1.2 + i / trail.length, 0, 7); c.fill(); });
        c.globalAlpha = 1;
        glowDot(c, x, y, 3.2, '#E9FBFF', 1, 14);
        const f = .4 + .6 * Math.abs(Math.sin(now * 22));
        c.fillStyle = 'rgba(200, 240, 255, .7)'; c.beginPath();
        c.ellipse(x - 3.5 * f, y - 2.5, 3.5 * f, 2, -.5, 0, 7); c.ellipse(x + 3.5 * f, y - 2.5, 3.5 * f, 2, .5, 0, 7); c.fill();
    }

    /** Your own mark on a waiting row, bobbing where its state icon is (the stylesheet hides that icon: body.ask-sticker). */
    function askSticker(c, row) {
        const at = (row.querySelector('.status') ?? row).getBoundingClientRect();
        drawSprite(c, stickers.ask, at.left + at.width / 2, at.top + at.height / 2 + Math.sin(now * 4) * 2, 18, Math.sin(now * 3) * .15, 1);
    }

    const SCENES = { sakura, wild, sea, star, pixel, range: (c, dt, t) => range.draw(c, dt, t, rview) };

    const resize = () => { fit(); wake(); };
    new ResizeObserver(resize).observe(main);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', wake);

    return {
        setSkin(id, m, t, opts = {}) {
            const changed = id !== skin;
            skin = id; motion = m; time = t; gun = opts.gun !== false;
            if (m === 'off') parts = [];
            if (changed) { parts = []; broken = false; reseed(); }
            fit();
            clear();
            wake();
        },

        /** A message went out: something flies off the send button. */
        send(el) {
            const o = motion !== 'off' && center(el);
            if (!o) return;
            if (skin === 'sakura') {
                for (let i = 0; i < 9; i++) { const a = rnd(-2.6, -1.9), v = rnd(120, 220); emit({ k: 'petal', x: o.x, y: o.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 40, drag: 1.4, vr: rnd(-5, 5), s: rnd(3.5, 6), col: pick(PETALS), max: rnd(.9, 1.4) }); }
            } else if (skin === 'wild') {
                const col = (SCENE[time] ?? SCENE.day).wind;
                for (let i = 0; i < 2; i++) emit({ k: 'wind', x: o.x - 10 - i * 14, y: o.y - 4, vx: -170, vy: -150, len: 70, ph: rnd(0, 6.3), col, max: .7, delay: i * .12 });
                for (let i = 0; i < 6; i++) { const a = rnd(-2.7, -1.8), v = rnd(110, 200); emit({ k: 'leaf', x: o.x, y: o.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 30, drag: 1.2, vr: rnd(-6, 6), s: rnd(3.5, 5.5), col: pick(LEAVES), max: rnd(1, 1.5) }); }
            } else if (skin === 'sea') {
                for (let i = 0; i < 10; i++) emit({ k: 'bubble', x: o.x + rnd(-6, 6), y: o.y - i * 7, vx: rnd(-12, 12), vy: rnd(-90, -150), r: rnd(1.5, 4.5), max: rnd(.8, 1.3) });
            } else if (skin === 'star') {
                const T = .45, dx = -rnd(80, 160), dy = -rnd(160, 240);
                emit({ k: 'streak', x: o.x, y: o.y, vx: dx / T, vy: dy / T, max: T, len: 50, col: '#F5C451' });
                setTimeout(() => { if (motion !== 'off') { sparks(o.x + dx, o.y + dy, 7, STARLIGHT); wake(); } }, T * 1000);
            } else if (skin === 'pixel') {
                for (let i = 0; i < 10; i++) { const a = rnd(-3, -.2), v = rnd(80, 170); emit({ k: 'square', x: o.x, y: o.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 380, s: pick([3, 4, 5]), col: pick(CONFETTI), max: rnd(.6, .9) }); }
            } else if (skin === 'range') {
                // the weapon fires at the crosshair; without it on screen the send button flashes and drops a casing
                const shot = range.fire(), m = main.getBoundingClientRect();
                emit({ k: 'ring', x: o.x, y: o.y, r0: 10, r1: 26, col: '#FF9A2E', max: .35 });
                if (shot && ambientOn()) {
                    const mx = m.left + shot.muzzle.x, my = m.top + shot.muzzle.y;
                    emit({ k: 'flash', x: mx, y: my, a: shot.muzzle.a, size: 26, max: .09 });
                    emit({ k: 'tracer', x: mx, y: my, x0: mx, y0: my, x2: m.left + shot.cross.x, y2: m.top + shot.cross.y, max: .14 });
                    emit({ k: 'casing', x: m.left + shot.port.x, y: m.top + shot.port.y, vx: rnd(120, 220), vy: rnd(-380, -280), ay: 1500, rot: rnd(0, 6), vr: rnd(14, 24), floor: m.bottom - 6, max: 1.3 });
                } else {
                    emit({ k: 'flash', x: o.x, y: o.r.top, a: -Math.PI / 2, size: 16, max: .09 });
                    emit({ k: 'casing', x: o.x, y: o.y - 10, vx: rnd(80, 160), vy: rnd(-360, -260), ay: 1500, vr: rnd(14, 24), floor: Math.min(H - 4, o.r.bottom + 30), max: 1.3 });
                }
            } else {
                emit({ k: 'ring', x: o.x, y: o.y, r0: 16, r1: 34, col: getComputedStyle(document.body).getPropertyValue('--moss').trim() || '#56735C', max: .6 });
            }
            wake();
        },

        /** A session finished: a show on its row (or wherever el is); name is the session's, for 靶场's feed. */
        done(el, name) {
            const o = motion !== 'off' && center(el);
            if (!o) return;
            const accent = getComputedStyle(document.body).getPropertyValue('--moss').trim() || '#56735C';
            if (skin === 'sakura') {
                for (let i = 0; i < 28; i++) { const a = rnd(-3.14, .3), v = rnd(60, 230); emit({ k: 'petal', x: o.x, y: o.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 70, drag: 1.6, vr: rnd(-6, 6), s: rnd(3.5, 7), col: pick(PETALS), max: rnd(1.2, 2) }); }
            } else if (skin === 'wild') {
                const cx = Math.min(o.r.right - 26, W - 30), cy = o.y + 4;
                emit({ k: 'chest', x: cx, y: cy, max: 2.2 });
                setTimeout(() => {
                    if (motion === 'off') return;
                    sparks(cx, cy - 8, 16, GOLD, [-2.6, -.5]);
                    critters(cx, cy - 10, 1, 3);
                    wake();
                }, 650);
            } else if (skin === 'sea') {
                for (let i = 0; i < 3; i++) emit({ k: 'ring', x: o.r.left + 22, y: o.y, r0: 3, r1: 56, col: '#3FD0C9', max: 1.3, delay: i * .25 });
                for (let i = 0; i < 14; i++) emit({ k: 'glow', x: o.x + rnd(-40, 60), y: o.y + rnd(-6, 10), vx: rnd(-10, 10), vy: rnd(-25, -60), r: rnd(1.5, 3), col: pick(SEA_GLOW), max: rnd(1.2, 2) });
            } else if (skin === 'star') {
                emit({ k: 'streak', x: -20, y: H * .12, vx: W * 1.4, vy: H * .5, max: .85, len: 140, col: '#FFF6D8' });
                sparks(o.r.left + 22, o.y, 16, STARLIGHT);
            } else if (skin === 'pixel') {
                for (let i = 0; i < 34; i++) { const a = rnd(-2.9, -.25), v = rnd(110, 260); emit({ k: 'square', x: o.x, y: o.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 520, vr: rnd(-8, 8), s: pick([3, 4, 5, 6]), col: pick(CONFETTI), max: rnd(1, 1.6) }); }
                emit({ k: 'text', x: o.r.left + 30, y: o.y - 8, vy: -36, text: '+1', col: '#E8553B', max: 1.1 });
            } else if (skin === 'range') {
                // into the feed; a big hit marker on the crosshair and a target goes down, or a small one on the row without the scene
                const v = ambientOn() ? rangeView() : null;
                const hit = range.knock(name || el.querySelector?.('.name')?.textContent || '会话', Date.now(), v?.hud ? v : null);
                const m = main.getBoundingClientRect();
                if (hit) {
                    const cx = m.left + hit.cross.x, cy = m.top + hit.cross.y;
                    emit({ k: 'hit', x: cx, y: cy, col: '#4FE3B0', len: 16, gap: 8, w: 3, max: .5 });
                    emit({ k: 'ring', x: cx, y: cy, r0: 14, r1: 60, col: '#4FE3B0', max: .5 });
                    emit({ k: 'text', x: cx + 28, y: cy - 14, vy: -30, text: '+100', col: '#4FE3B0', max: .9 });
                    if (hit.target) {
                        const tx = m.left + hit.target.x, ty = m.top + hit.target.y;
                        emit({ k: 'hit', x: tx, y: ty, col: '#FFFFFF', len: 6, gap: 3, w: 2, max: .32 });
                        shards(tx, ty, 6, '#E9E3D6');
                    }
                } else {
                    const x = o.r.left + 22;
                    emit({ k: 'hit', x, y: o.y, col: '#4FE3B0', len: 9, gap: 5, w: 2.5, max: .45 });
                    emit({ k: 'text', x: x + 16, y: o.y - 8, vy: -30, text: '+100', col: '#4FE3B0', max: .9 });
                }
            } else {
                emit({ k: 'ring', x: o.r.left + 22, y: o.y, r0: 4, r1: 46, col: accent, max: .9 });
                for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; emit({ k: 'dot', x: o.r.left + 22, y: o.y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, drag: 3, r: 2, col: accent, max: .7 }); }
            }
            if (stickers.done) {
                for (let i = 0; i < 5; i++) emit({ k: 'sprite', img: stickers.done, x: o.x, y: o.y, vx: rnd(-50, 90), vy: rnd(-120, -200), ay: 160, vr: rnd(-3, 3), s: rnd(18, 26), max: rnd(1.2, 1.8), delay: i * .08 });
            }
            wake();
        },

        /** A click on an empty spot of the chat: each skin's small surprise. */
        click(x, y) {
            if (motion === 'off') return;
            if (skin === 'sakura') {
                for (let i = 0; i < 8; i++) { const a = rnd(0, 6.3), v = rnd(40, 120); emit({ k: 'petal', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 50, drag: 1.5, vr: rnd(-6, 6), s: rnd(3.5, 6), col: pick(PETALS), max: rnd(1, 1.6) }); }
            } else if (skin === 'wild') {
                scene.gust = 1.4;
                critters(x, y, 3, 6);
            } else if (skin === 'sea') {
                for (let i = 0; i < 8; i++) emit({ k: 'bubble', x: x + rnd(-8, 8), y: y + rnd(-4, 4), vx: rnd(-10, 10), vy: rnd(-60, -120), r: rnd(1.5, 4.5), max: rnd(.8, 1.4) });
            } else if (skin === 'star') {
                sparks(x, y, 9, STARLIGHT);
            } else if (skin === 'pixel') {
                for (let i = 0; i < 12; i++) { const a = rnd(-3, -.2), v = rnd(70, 160); emit({ k: 'square', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 420, s: pick([3, 4, 5]), col: pick(CONFETTI), max: rnd(.6, 1) }); }
            } else if (skin === 'range') {
                emit({ k: 'hit', x, y, col: '#FFFFFF', len: 9, gap: 5, w: 2, max: .32 });
                shards(x, y, 7, '#FF9A2E');
                emit({ k: 'hole', x, y, max: 2.4, cracks: Array.from({ length: 5 }, () => ({ a: rnd(0, 6.3), l: rnd(4, 9) })) });
                range.shot();
            } else {
                emit({ k: 'ring', x, y, r0: 2, r1: 30, col: getComputedStyle(document.body).getPropertyValue('--moss').trim() || '#56735C', max: .7 });
            }
            wake();
        },

        /** A message did not go out: 靶场 takes a hit (health drops, the window's edge flashes red). */
        hurt() {
            range.hurt();
            if (skin !== 'range' || motion === 'off') return;
            if (ambientOn()) {
                const v = rangeView(), m = main.getBoundingClientRect(), cr = range.crossAt(v);
                emit({ k: 'dmg', x: m.left + cr.x, y: m.top + cr.y, a: rnd(0, 6.3), max: 1 });
            }
            wake();
        },

        /** The live connection came or went: 靶场's health bar shows it. */
        setOnline(on) {
            range.setOnline(on);
            wake();
        },

        /** Your own stickers ({ fall, done, ask }, each a loaded image or null). */
        setStickers(next) {
            stickers = { fall: next.fall ?? null, done: next.done ?? null, ask: next.ask ?? null };
            wake();
        },

        /** Something on the page changed (a row may be waiting now): start drawing if there is anything to draw. */
        wake,
    };
}
