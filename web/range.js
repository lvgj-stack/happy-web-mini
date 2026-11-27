// 靶场: the shooting-range skin's scene, HUD, weapon and its own event shows,
// for effects.js to call. The chat area is a firing range: a crosshair in the
// middle, round targets on a rail, a radar of the sessions, a "connection"
// health bar, and a weapon of its own design that fires when you send a
// message (one round per message, reloads after 30). No real gun models, no
// blood, nothing from any particular game. Browser drawing only; the pure
// helpers at the top are what the tests cover.

export const MAG = 30;
export const RELOAD = 1.3;
const STREAK_GAP = 5000;
const MAX_BLIPS = 12;
const C = { ink: '#DCE4E8', dim: '#7F8C95', amber: '#FF9A2E', ok: '#4FE3B0', red: '#FF5757' };
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- pure helpers ----------

/** One message fired: a round less; the last one starts a reload. Rounds fired while reloading are free. */
export function fireRound(m) {
    if (m.reload > 0) return m;
    const ammo = Math.max(0, m.ammo - 1);
    return { ammo, reload: ammo === 0 ? RELOAD : 0 };
}

/** Time passes: a reload counts down and refills the magazine when it is done. */
export function tickMagazine(m, dt) {
    if (m.reload <= 0) return m;
    const reload = m.reload - dt;
    return reload <= 0 ? { ammo: MAG, reload: 0 } : { ammo: m.ammo, reload };
}

/** A session done at `now` (ms): one more in the streak if the last was within 5 s, else a new streak. */
export function nextStreak(s, now) {
    return { count: now - s.at < STREAK_GAP && s.count > 0 ? s.count + 1 : 1, at: now };
}

function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

/**
 * Radar blips for sidebar rows ({ id, status: 'working' | 'waiting' | other }):
 * working and waiting first, at most 12, each at a spot set by its id alone
 * (a = angle in radians, r = 0.3–0.9 of the radius) so blips do not jump.
 */
export function blipSpots(rows) {
    const hot = (r) => r.status === 'working' || r.status === 'waiting';
    return [...rows.filter(hot), ...rows.filter((r) => !hot(r))].slice(0, MAX_BLIPS).map((row) => {
        const h = hash(row.id);
        return { id: row.id, status: row.status, a: (h % 3600) / 3600 * Math.PI * 2, r: .3 + ((h >>> 12) % 600) / 1000 };
    });
}

/**
 * Where the HUD may draw, in the chat area's own coordinates: below the chat
 * header, above the composer, left of the docked links panel. Each of those is
 * a DOMRect-like box, or null / zero-sized when not shown.
 */
export function hudArea({ main, head, composer, links }) {
    const shown = (r) => r && r.width > 0 && r.height > 0;
    return {
        top: shown(head) ? Math.max(0, head.bottom - main.top) : 0,
        bottom: shown(composer) ? Math.min(main.height, composer.top - main.top) : main.height,
        right: shown(links) ? Math.max(0, links.left - main.left) : main.width,
    };
}

// ---------- event particles ----------

/** 靶场's own event particles (effects.js moves them; this draws them). k = how far through its life, 0–1. */
export function drawRangeParticle(c, p, k) {
    c.save();
    switch (p.k) {
    case 'flash': {
        const s = p.size * (1 - k * .4);
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 1.8);
        g.addColorStop(0, 'rgba(255, 236, 190, .95)'); g.addColorStop(.35, 'rgba(255, 154, 46, .6)'); g.addColorStop(1, 'rgba(255, 120, 30, 0)');
        c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, s * 1.8, 0, 7); c.fill();
        c.translate(p.x, p.y); c.rotate(p.a); c.fillStyle = 'rgba(255, 246, 220, .95)'; c.beginPath();
        for (let j = 0; j < 10; j++) { const r = j % 2 ? s * .25 : (j === 0 ? s * 1.4 : s * .7), t = j / 10 * Math.PI * 2; c.lineTo(Math.cos(t) * r, Math.sin(t) * r * .7); }
        c.closePath(); c.fill();
        break;
    }
    case 'tracer': {
        const h = Math.min(1, k * 1.6), t0 = Math.max(0, h - .35);
        const lx = (t) => p.x0 + (p.x2 - p.x0) * t, ly = (t) => p.y0 + (p.y2 - p.y0) * t;
        c.strokeStyle = `rgba(255, 214, 150, ${1 - k})`; c.lineWidth = 2; c.lineCap = 'round';
        c.beginPath(); c.moveTo(lx(t0), ly(t0)); c.lineTo(lx(h), ly(h)); c.stroke();
        break;
    }
    case 'casing': {
        // bounces once or twice on the floor, then fades
        if (p.y > p.floor && p.vy > 0) { p.y = p.floor; p.vy *= -.32; p.vx *= .55; p.vr *= .5; }
        c.globalAlpha = k > .75 ? (1 - k) / .25 : 1;
        c.translate(p.x, p.y); c.rotate(p.rot);
        const g = c.createLinearGradient(0, -2, 0, 2); g.addColorStop(0, '#F3CB72'); g.addColorStop(1, '#9C6B22');
        c.fillStyle = g; c.fillRect(-5, -2, 10, 4);
        c.fillStyle = '#7A5218'; c.fillRect(4, -2.2, 1.6, 4.4);
        break;
    }
    case 'hit': {
        const sc = .7 + .3 * Math.min(1, k * 5), g = p.gap * sc * .707, l = (p.gap + p.len) * sc * .707;
        c.globalAlpha = 1 - k * k; c.strokeStyle = p.col; c.lineWidth = p.w; c.shadowColor = 'rgba(0, 0, 0, .7)'; c.shadowBlur = 2;
        c.beginPath();
        for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { c.moveTo(p.x + dx * g, p.y + dy * g); c.lineTo(p.x + dx * l, p.y + dy * l); }
        c.stroke();
        break;
    }
    case 'shard': {
        const v = Math.hypot(p.vx, p.vy) || 1;
        c.globalAlpha = 1 - k; c.strokeStyle = p.col; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx / v * 6, p.y - p.vy / v * 6); c.stroke();
        break;
    }
    case 'hole': {
        c.globalAlpha = k < .6 ? 1 : 1 - (k - .6) / .4;
        c.strokeStyle = 'rgba(210, 220, 225, .3)'; c.lineWidth = 1; c.beginPath();
        for (const cr of p.cracks) { c.moveTo(p.x + Math.cos(cr.a) * 3.5, p.y + Math.sin(cr.a) * 3.5); c.lineTo(p.x + Math.cos(cr.a) * (3.5 + cr.l), p.y + Math.sin(cr.a) * (3.5 + cr.l)); }
        c.stroke();
        c.fillStyle = '#06080A'; c.beginPath(); c.arc(p.x, p.y, 3.2, 0, 7); c.fill();
        c.strokeStyle = 'rgba(210, 220, 225, .4)'; c.beginPath(); c.arc(p.x, p.y, 3.8, 0, 7); c.stroke();
        break;
    }
    case 'dmg':
        c.globalAlpha = 1 - k; c.strokeStyle = C.red; c.lineWidth = 7; c.lineCap = 'round';
        c.beginPath(); c.arc(p.x, p.y, 74, p.a - .45, p.a + .45); c.stroke();
        break;
    }
    c.restore();
}

// ---------- the range ----------

/**
 * The range's own state: magazine, recoil, connection health, targets, the
 * done feed. effects.js calls draw() on the ambient canvas (chat-area
 * coordinates) and overlay() on the event canvas (window coordinates).
 */
export function createRange() {
    let W = 0, H = 0;
    let mag = { ammo: 24, reload: 0 };
    let recoil = 0, spread = 0, hp = 100, hpShown = 100, hold = 0, online = true;
    let streak = { count: 0, at: 0 }, streakShow = null, hurtAge = 9;
    let targets = [], dust = [], feed = [];
    let muzzle = null, port = null, cross = null;
    const locks = new Map(); // waiting row id → when its lock-on started

    function seed(w, h) {
        W = w; H = h;
        targets = [.2, .52, .78].map((f, i) => ({ f, v: (i % 2 ? -1 : 1) * rnd(.022, .036), down: 0, wait: 0, falling: false }));
        dust = Array.from({ length: Math.round(Math.min(40, Math.max(16, w * h / 24000))) }, () => ({ x: Math.random(), y: Math.random(), vx: rnd(.004, .014), vy: -rnd(.004, .014), ph: rnd(0, 6.3), r: rnd(.6, 1.6) }));
    }

    /** Recoil, reload, health and falling targets move on whether or not the scene is drawn. */
    function tick(dt) {
        mag = tickMagazine(mag, dt);
        recoil = Math.max(0, recoil - dt * 6);
        spread = Math.max(0, spread - dt * 3);
        if (!online) hp = Math.min(hp, 35);
        else if (hold > 0) hold -= dt;
        else if (hp < 100) hp = Math.min(100, hp + dt * 26);
        hpShown += (hp - hpShown) * Math.min(1, dt * 8);
        hurtAge += dt;
        for (const t of targets) {
            if (t.falling) { t.down = Math.min(1, t.down + dt * 5); if (t.down === 1) { t.falling = false; t.wait = 1.6; } }
            else if (t.wait > 0) t.wait -= dt;
            else if (t.down > 0) t.down = Math.max(0, t.down - dt * 2.5);
        }
    }

    const horizon = (v) => Math.min(v.top + (v.bottom - v.top) * .62, v.bottom - 40);
    const crossAt = (v) => ({ x: v.right / 2, y: v.top + (v.bottom - v.top) * .42 });

    // ----- ambient -----

    function draw(c, dt, t, v) {
        if (v.bottom - v.top < 120 || v.right < 160) { muzzle = port = null; return; } // too small to draw (a phone with its keyboard up)
        const hz = horizon(v), vx = v.right / 2;
        for (const p of dust) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y < -.02) { p.y = 1.02; p.x = Math.random(); } if (p.x > 1.02) p.x = -.02; }
        for (const tg of targets) if (!tg.down && !tg.falling && tg.wait <= 0) { tg.f += tg.v * dt; if (tg.f < .1 || tg.f > .9) { tg.v = -tg.v; tg.f = Math.max(.1, Math.min(.9, tg.f)); } }

        // the back wall's grid and the range floor running to the horizon
        c.strokeStyle = 'rgba(120, 170, 180, .05)'; c.lineWidth = 1; c.beginPath();
        for (let x = vx % 36; x < v.right; x += 36) { c.moveTo(x + .5, v.top); c.lineTo(x + .5, hz); }
        for (let y = hz; y > v.top; y -= 36) { c.moveTo(0, y + .5); c.lineTo(v.right, y + .5); }
        c.stroke();
        cross = crossAt(v);
        if (!v.hud) { muzzle = port = null; return; } // the settings and usage pages keep just the grid behind them
        const fl = c.createLinearGradient(0, hz, 0, H);
        fl.addColorStop(0, 'rgba(79, 227, 176, .05)'); fl.addColorStop(1, 'rgba(0, 0, 0, .22)');
        c.fillStyle = fl; c.fillRect(0, hz, v.right, H - hz);
        c.strokeStyle = 'rgba(79, 227, 176, .07)'; c.beginPath();
        for (let j = -10; j <= 10; j++) { c.moveTo(vx + j * 6, hz); c.lineTo(vx + j * v.right * .16, H); }
        for (let i = 1; i <= 9; i++) { const y = hz + (H - hz) * (i / 9) ** 2; c.moveTo(0, y); c.lineTo(v.right, y); }
        c.stroke();
        c.strokeStyle = 'rgba(79, 227, 176, .18)'; c.beginPath(); c.moveTo(0, hz + .5); c.lineTo(v.right, hz + .5); c.stroke();

        for (const tg of targets) {
            c.save(); c.translate(tg.f * v.right, hz); c.scale(1, 1 - tg.down * .92); c.globalAlpha = .55;
            c.fillStyle = '#3A464E'; c.fillRect(-1.5, -26, 3, 26);
            ['#E9E3D6', '#2A3137', '#E9E3D6', '#2A3137'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(0, -40, 14 - i * 3.3, 0, 7); c.fill(); });
            c.fillStyle = C.amber; c.beginPath(); c.arc(0, -40, 2.6, 0, 7); c.fill();
            c.restore();
        }
        for (const p of dust) {
            c.fillStyle = `rgba(220, 228, 232, ${.12 + .12 * Math.sin(t * 1.5 + p.ph)})`;
            c.beginPath(); c.arc(p.x * v.right, p.y * H, p.r, 0, 7); c.fill();
        }
        const sy = v.top + (t * 38) % (H - v.top + 60) - 30;
        const sg = c.createLinearGradient(0, sy - 30, 0, sy + 30);
        sg.addColorStop(0, 'rgba(79, 227, 176, 0)'); sg.addColorStop(.5, 'rgba(79, 227, 176, .035)'); sg.addColorStop(1, 'rgba(79, 227, 176, 0)');
        c.fillStyle = sg; c.fillRect(0, sy - 30, v.right, 60);

        drawCrosshair(c, cross);
        if (v.gun && v.bottom - v.top > 260) drawGun(c, t, v); else muzzle = port = null;
        drawRadar(c, t, v);
        drawHealth(c, v);
        drawAmmo(c, v);
    }

    function drawCrosshair(c, { x, y }) {
        const gap = 5 + spread * 12, len = 8;
        c.save(); c.strokeStyle = 'rgba(79, 227, 176, .85)'; c.lineWidth = 2; c.shadowColor = 'rgba(0, 0, 0, .8)'; c.shadowBlur = 2;
        c.beginPath();
        c.moveTo(x - gap - len, y); c.lineTo(x - gap, y); c.moveTo(x + gap, y); c.lineTo(x + gap + len, y);
        c.moveTo(x, y - gap - len); c.lineTo(x, y - gap); c.moveTo(x, y + gap); c.lineTo(x, y + gap + len);
        c.stroke();
        c.fillStyle = 'rgba(79, 227, 176, .9)'; c.fillRect(x - 1, y - 1, 2, 2);
        c.restore();
    }

    /** The weapon, from the bottom right corner, aimed at the crosshair. Records its muzzle and ejection port. */
    function drawGun(c, t, v) {
        const s = Math.max(.5, Math.min(1, (v.bottom - v.top) / 640));
        const rl = mag.reload > 0 ? Math.sin(Math.PI * (1 - mag.reload / RELOAD)) : 0;
        const ox = v.right - 64 * s + Math.sin(t * 1.1) * 4, oy = v.bottom + 4 + Math.sin(t * 2.2) * 2.5 + rl * 80 * s;
        const ang = Math.atan2(cross.y - oy, cross.x - ox) + Math.PI + recoil * .09 - rl * .5;
        c.save();
        c.translate(ox, oy); c.rotate(ang); c.scale(s, s); c.translate(recoil * 18, 0);
        const poly = (pts, fill) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fillStyle = fill; c.fill(); };
        poly([[-44, -24], [0, -24], [28, 58], [-8, 64]], '#1A2025');
        poly([[0, -76], [44, -68], [50, -26], [0, -22]], '#232B31');
        const body = c.createLinearGradient(0, -80, 0, -20);
        body.addColorStop(0, '#46535C'); body.addColorStop(.45, '#2E373E'); body.addColorStop(1, '#1D2429');
        poly([[-214, -78], [0, -78], [0, -22], [-184, -22], [-214, -42]], body);
        c.fillStyle = '#171C20'; c.fillRect(-196, -88, 156, 10);
        c.fillStyle = '#2B343A'; for (let x = -190; x < -44; x += 12) c.fillRect(x, -88, 6, 4);
        poly([[-300, -66], [-214, -70], [-214, -36], [-300, -40]], '#20272C');
        c.fillStyle = `rgba(255, 154, 46, ${.35 + recoil * .6})`;
        for (let i = 0; i < 3; i++) c.fillRect(-286 + i * 22, -60, 12, 4);
        c.fillStyle = '#121619'; c.fillRect(-312, -68, 14, 30);
        // the energy cell shows what is left in the magazine
        const cell = mag.reload > 0 ? 1 - mag.reload / RELOAD : mag.ammo / MAG;
        c.fillStyle = 'rgba(255, 154, 46, .15)'; c.fillRect(-152, -64, 92, 14);
        c.shadowColor = C.amber; c.shadowBlur = 10; c.fillStyle = C.amber; c.fillRect(-152, -64, 92 * cell, 14); c.shadowBlur = 0;
        c.strokeStyle = 'rgba(255, 154, 46, .55)'; c.lineWidth = 2; c.beginPath(); c.moveTo(-206, -32); c.lineTo(-12, -32); c.stroke();
        const m = c.getTransform(), mp = m.transformPoint(new DOMPoint(-314, -53)), pp = m.transformPoint(new DOMPoint(-96, -80)), d = Math.hypot(m.a, m.b) / s; // the canvas's pixel ratio
        muzzle = { x: mp.x / d, y: mp.y / d, a: ang + Math.PI };
        port = { x: pp.x / d, y: pp.y / d };
        c.restore();
    }

    function drawRadar(c, t, v) {
        const R = Math.max(28, Math.min(44, v.right * .07)), cx = 14 + R, cy = v.top + 14 + R;
        if (cy + R > horizon(v)) return;
        c.save();
        c.fillStyle = 'rgba(6, 10, 12, .62)'; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fill();
        c.strokeStyle = 'rgba(79, 227, 176, .3)'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
        c.strokeStyle = 'rgba(79, 227, 176, .12)'; c.beginPath();
        c.arc(cx, cy, R * .5, 0, 7); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
        const sweep = t * 1.6;
        for (let i = 0; i < 14; i++) {
            c.fillStyle = `rgba(79, 227, 176, ${.16 * (1 - i / 14)})`;
            c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, sweep - (i + 1) * .06, sweep - i * .06); c.closePath(); c.fill();
        }
        for (const b of v.blips) {
            const d = ((sweep - b.a) % 6.283 + 6.283) % 6.283;
            const waiting = b.status === 'waiting';
            c.globalAlpha = waiting ? (Math.sin(t * 8) > 0 ? 1 : .3) : .35 + .65 * Math.exp(-d * 1.3);
            c.fillStyle = waiting ? C.red : b.status === 'working' ? C.amber : C.dim;
            c.beginPath(); c.arc(cx + Math.cos(b.a) * b.r * R, cy + Math.sin(b.a) * b.r * R, b.status === 'idle' ? 2 : 3, 0, 7); c.fill();
        }
        c.globalAlpha = 1; c.fillStyle = C.ink;
        c.beginPath(); c.moveTo(cx, cy - 5); c.lineTo(cx + 4, cy + 4); c.lineTo(cx - 4, cy + 4); c.closePath(); c.fill();
        c.restore();
    }

    function drawHealth(c, v) {
        const x = 16, y = v.bottom - 16, hurt = hp < 100 || !online;
        c.save(); c.globalAlpha = .85; c.shadowColor = 'rgba(0, 0, 0, .8)'; c.shadowBlur = 3;
        c.fillStyle = hurt ? C.red : C.ok; c.fillRect(x, y - 19, 14, 4); c.fillRect(x + 5, y - 24, 4, 14);
        c.font = `bold 24px ${MONO}`; c.textAlign = 'left'; c.fillStyle = hurt ? C.red : C.ink;
        c.fillText(String(Math.round(hpShown)), x + 22, y - 6);
        c.shadowBlur = 0;
        const bw = 90, by = y + 2;
        c.fillStyle = 'rgba(255, 255, 255, .1)'; c.fillRect(x, by, bw, 5);
        c.fillStyle = hurt ? C.red : C.ok; c.fillRect(x, by, bw * hpShown / 100, 5);
        c.font = `600 10px ${MONO}`; c.fillStyle = C.dim;
        c.fillText(!online ? '连接 · 重连中' : hp < 100 ? '连接 · 恢复中' : '连接 · 稳定', x, y - 30);
        c.restore();
    }

    function drawAmmo(c, v) {
        const rx = v.right - 16, y = v.bottom - 16, low = mag.reload <= 0 && mag.ammo <= 5;
        c.save(); c.globalAlpha = .85; c.shadowColor = 'rgba(0, 0, 0, .85)'; c.shadowBlur = 3; c.textAlign = 'right';
        c.font = `600 15px ${MONO}`; c.fillStyle = C.dim; c.fillText('/ ∞', rx, y - 6);
        const rw = c.measureText('/ ∞').width;
        c.font = `bold 26px ${MONO}`; c.fillStyle = mag.reload > 0 ? C.dim : low ? C.red : C.ink;
        c.fillText(mag.reload > 0 ? '--' : String(mag.ammo), rx - rw - 6, y - 6);
        c.shadowBlur = 0;
        for (let i = 0; i < MAG; i++) {
            const on = mag.reload > 0 ? i < MAG * (1 - mag.reload / RELOAD) : i < mag.ammo;
            c.fillStyle = on ? (low ? C.red : C.amber) : 'rgba(255, 255, 255, .12)';
            c.fillRect(rx - (MAG - i) * 4 + 1, y + 2, 2.4, 7);
        }
        c.font = `600 10px ${MONO}`; c.fillStyle = mag.reload > 0 ? C.amber : C.dim;
        c.fillText(mag.reload > 0 ? '装填中' : '弹匣 · 指令', rx, y - 34);
        c.restore();
    }

    // ----- event canvas -----

    /** The done feed, the streak call-out and the hit flash at the window's edge. Returns whether any is still showing. */
    function overlay(c, dt, v) {
        feed = feed.filter((f) => (f.age += dt) < 4.6);
        // not over the settings or usage page
        if (v.hud) feed.forEach((f, i) => {
            const slide = (1 - Math.min(1, f.age / .22)) * 24, fade = f.age > 4.2 ? (4.6 - f.age) / .4 : 1;
            const name = f.name.length > 18 ? f.name.slice(0, 17) + '…' : f.name;
            c.save(); c.globalAlpha = Math.min(1, f.age / .15) * fade;
            c.font = `600 12px ${MONO}`;
            const parts = [['Claude', C.amber], [null, null], [name, C.ink], ['完成', C.ok]];
            const widths = parts.map(([s]) => (s ? c.measureText(s).width : 14));
            const w = widths.reduce((a, b) => a + b, 0) + 7 * (parts.length - 1) + 18;
            const x = v.left + v.right - 12 - w + slide, y = v.y0 + v.top + 12 + i * 28;
            c.fillStyle = 'rgba(8, 12, 14, .82)'; c.fillRect(x, y, w, 22);
            c.strokeStyle = 'rgba(79, 227, 176, .3)'; c.lineWidth = 1; c.strokeRect(x + .5, y + .5, w - 1, 21);
            let px = x + 9;
            c.textBaseline = 'middle';
            parts.forEach(([s, col], j) => {
                if (s) { c.fillStyle = col; c.fillText(s, px, y + 11.5); } else {
                    c.strokeStyle = C.ok; c.lineWidth = 1.4; c.beginPath(); c.arc(px + 7, y + 11, 5, 0, 7); c.stroke();
                    c.strokeStyle = C.amber; c.beginPath(); c.moveTo(px + 4.5, y + 11); c.lineTo(px + 6.5, y + 13); c.lineTo(px + 9.5, y + 9); c.stroke();
                }
                px += widths[j] + 7;
            });
            c.restore();
        });
        if (streakShow) {
            streakShow.age += dt;
            const a = streakShow.age;
            if (a > 1.3) streakShow = null;
            else {
                const sc = a < .2 ? 1.6 - 3 * a : 1, al = a < .2 ? a / .2 : a > 1 ? (1.3 - a) / .3 : 1;
                c.save(); c.globalAlpha = al; c.translate(v.left + v.right / 2, v.y0 + v.top + (v.bottom - v.top) * .2 - (a > 1 ? (a - 1) * 25 : 0)); c.scale(sc, sc);
                c.font = `bold 22px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
                c.shadowColor = 'rgba(79, 227, 176, .6)'; c.shadowBlur = 14; c.fillStyle = C.ok;
                c.fillText(`连续完成 ×${streakShow.count}`, 0, 0);
                c.restore();
            }
        }
        if (hurtAge < 1) {
            const g = c.createRadialGradient(v.winW / 2, v.winH / 2, Math.min(v.winW, v.winH) * .3, v.winW / 2, v.winH / 2, Math.max(v.winW, v.winH) * .75);
            g.addColorStop(0, 'rgba(255, 50, 50, 0)'); g.addColorStop(1, `rgba(255, 50, 50, ${.5 * (1 - hurtAge)})`);
            c.fillStyle = g; c.fillRect(0, 0, v.winW, v.winH);
        }
        return busy();
    }

    const busy = () => feed.length > 0 || !!streakShow || hurtAge < 1;

    /** A waiting row: four red corners close in on it, then breathe. */
    function lockOn(c, row, t) {
        const r = row.getBoundingClientRect(), id = row.dataset.id ?? '';
        if (!locks.has(id)) locks.set(id, t);
        const e = 1 - Math.pow(1 - Math.min(1, (t - locks.get(id)) / .45), 3);
        const g = 1 + 14 * (1 - e) + (Math.sin(t * 5) + 1) * 1.2, L = 8;
        const x = r.left + 2, y = r.top + 2, w = r.width - 4, h = r.height - 4;
        c.save(); c.globalAlpha = e; c.strokeStyle = C.red; c.lineWidth = 2; c.beginPath();
        for (const [cx, cy, dx, dy] of [[x - g, y - g, 1, 1], [x + w + g, y - g, -1, 1], [x - g, y + h + g, 1, -1], [x + w + g, y + h + g, -1, -1]]) {
            c.moveTo(cx + dx * L, cy); c.lineTo(cx, cy); c.lineTo(cx, cy + dy * L);
        }
        c.stroke(); c.restore();
    }

    return {
        seed, tick, draw, overlay, busy, lockOn,
        /** Forget lock-ons of rows no longer waiting, so a row that waits again gets the closing-in again. */
        keepLocks(ids) { for (const id of locks.keys()) if (!ids.includes(id)) locks.delete(id); },
        /** Drop what is still showing (feed, streak, red flash, lock-ons, the weapon's spot): the skin or motion changed. */
        reset() { feed = []; streakShow = null; hurtAge = 9; locks.clear(); muzzle = port = null; },
        /** A message sent: one round, recoil; where the shot comes from (chat-area coordinates), or null without a weapon on screen. */
        fire() {
            mag = fireRound(mag);
            recoil = 1; spread = 1;
            return muzzle && port && cross ? { muzzle, port, cross } : null;
        },
        /**
         * A session done: into the feed (and the streak), and a standing target
         * goes down. With the scene's view, where the crosshair and that target
         * are (chat-area coordinates) for their hit markers.
         */
        knock(name, at, v) {
            streak = nextStreak(streak, at);
            if (streak.count >= 2) streakShow = { count: streak.count, age: 0 };
            feed.push({ name, age: 0 });
            if (feed.length > 4) feed.shift();
            const up = targets.filter((tg) => !tg.down && !tg.falling);
            const tg = up[Math.floor(Math.random() * up.length)];
            if (tg) tg.falling = true;
            return v ? { cross: crossAt(v), target: tg ? { x: tg.f * v.right, y: horizon(v) - 40 } : null } : null;
        },
        shot() { spread = Math.max(spread, .5); },
        /** A send failed: health drops a chunk and the window's edge flashes red. */
        hurt() { hp = Math.max(18, hp - 30); hold = 1.3; hurtAge = 0; },
        crossAt,
        setOnline(on) { online = !!on; if (on) hold = .4; },
    };
}
