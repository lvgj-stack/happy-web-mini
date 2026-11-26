// Skin effects: an ambient scene behind the chat and small shows at the moments
// that matter (a message sent, a session done, waiting for you, a click on an
// empty spot). Two canvases, both pointer-events: none — one inside <main>
// under its content (z-index -1 in main's own stacking context), one fixed
// over the window. One requestAnimationFrame loop draws both; it pauses while
// the tab is hidden and stops when nothing is left to draw. Browser only:
// nothing here runs until createEffects() is called. Drawings follow the
// skins preview page; every shape is drawn here, no images.

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const PETALS = ['#F4A7B9', '#F7C5D0', '#EE8FA6', '#FBD9E1', '#F9B3C4'];
const LEAVES = ['#8DB255', '#B8C95A', '#D9A441', '#7FA65A'];
const WINGS = ['#F2A03D', '#F7D25C', '#9FC6E8', '#F0F0E8'];
const GOLD = ['#F7D25C', '#FFF3C4', '#F2A03D'];
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
    case 'dot': c.globalAlpha = fade; c.fillStyle = p.col; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill(); c.globalAlpha = 1; break;
    case 'ring': {
        const e = 1 - Math.pow(1 - k, 3);
        c.globalAlpha = (1 - k) * .8; c.strokeStyle = p.col; c.lineWidth = 2 * (1 - k) + .5;
        c.beginPath(); c.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * e, 0, 7); c.stroke(); c.globalAlpha = 1;
        break;
    }
    }
    return true;
}

// ---------- the module ----------

/**
 * Starts the effects for the page.
 * @param {{ main: HTMLElement }} opts the chat area; the ambient scene draws behind its content
 * @returns {{ setSkin(id: string, motion: string, time: string): void, send(el: Element): void,
 *   done(el: Element): void, click(x: number, y: number): void, wake(): void }}
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
    let raf = 0, last = 0, now = 0;
    let parts = [];               // event particles, in window coordinates
    let scene = {};               // the ambient scene's own state
    const trails = new Map();     // fairy trails by row id

    function fit() {
        // The window can move to a screen with another pixel ratio without resizing: reallocate then too.
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const moved = ratio !== dpr;
        dpr = ratio;
        const r = main.getBoundingClientRect();
        if (moved || Math.round(r.width) !== MW || Math.round(r.height) !== MH) {
            MW = Math.round(r.width); MH = Math.round(r.height);
            amb.width = MW * dpr; amb.height = MH * dpr;
            seed();
        }
        if (moved || window.innerWidth !== W || window.innerHeight !== H) {
            W = window.innerWidth; H = window.innerHeight;
            fx.width = W * dpr; fx.height = H * dpr;
        }
    }

    const ambientOn = () => motion === 'full' && skin !== 'moss' && MW > 0 && MH > 0;
    /** Waiting rows the sprite can circle: on screen only, so a hidden sidebar (a phone in a chat) does not keep the loop running. */
    const waitingRows = () => (motion === 'off' || skin !== 'wild' ? [] : [...document.querySelectorAll('#list .row.asking')].filter((row) => {
        const r = row.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    }));

    function wake() {
        if (raf || document.hidden) return;
        if (!ambientOn() && !parts.length && !waitingRows().length) { clear(); return; }
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
        actx.setTransform(dpr, 0, 0, dpr, 0, 0); actx.clearRect(0, 0, MW, MH);
        if (ambientOn()) (skin === 'sakura' ? sakura : wild)(actx, dt, now);
        fctx.setTransform(dpr, 0, 0, dpr, 0, 0); fctx.clearRect(0, 0, W, H);
        parts = parts.filter((p) => drawParticle(fctx, p, dt));
        const rows = waitingRows();
        for (const row of rows) fairy(fctx, row);
        if (!rows.length) trails.clear();
        if (ambientOn() || parts.length || rows.length) raf = requestAnimationFrame(frame);
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
    }

    function sakura(c, dt) {
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
        for (const p of scene.leaves) {
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

    const resize = () => { fit(); wake(); };
    new ResizeObserver(resize).observe(main);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', wake);

    return {
        setSkin(id, m, t) {
            const changed = id !== skin;
            skin = id; motion = m; time = t;
            if (m === 'off') parts = [];
            if (changed) { parts = []; seed(); }
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
            } else {
                emit({ k: 'ring', x: o.x, y: o.y, r0: 16, r1: 34, col: getComputedStyle(document.body).getPropertyValue('--moss').trim() || '#56735C', max: .6 });
            }
            wake();
        },

        /** A session finished: a show on its row (or wherever el is). */
        done(el) {
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
            } else {
                emit({ k: 'ring', x: o.r.left + 22, y: o.y, r0: 4, r1: 46, col: accent, max: .9 });
                for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; emit({ k: 'dot', x: o.r.left + 22, y: o.y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, drag: 3, r: 2, col: accent, max: .7 }); }
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
            } else {
                emit({ k: 'ring', x, y, r0: 2, r1: 30, col: getComputedStyle(document.body).getPropertyValue('--moss').trim() || '#56735C', max: .7 });
            }
            wake();
        },

        /** Something on the page changed (a row may be waiting now): start drawing if there is anything to draw. */
        wake,
    };
}
