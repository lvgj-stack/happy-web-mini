// Skins: a palette for the page plus a scene for effects.js. The pick is kept
// per browser. 苔绿 is the stylesheet's own look and sets no colors; the others
// override the CSS variables on <body> (app.js), so they also beat the Mac
// app's variables under body.desktop-mac. 旷野 follows the clock: day, dusk
// and a dark night.

const KEY = 'happy.skin';
const MOTIONS = ['full', 'events', 'off'];

/** Every color the stylesheet reads from a skin, from a few base ones. */
function palette(p) {
    return {
        '--paper': p.paper, '--sheet': p.sheet, '--ink': p.ink, '--muted': p.muted, '--rule': p.rule,
        '--moss': p.accent, '--moss-tint': p.tint, '--amber': p.amber, '--surface': p.surface,
        '--ink-rgb': p.inkRgb, '--head': p.head, '--head-hover': p.headHover, '--code-bg': p.code,
        '--accent-hover': p.accentHover, '--idle': p.idle, '--faint': p.faint,
        '--glass': p.glass, '--sel': p.sel, '--ring': p.ring, '--menu': p.menu,
        ...p.extra,
    };
}

const SAKURA = palette({
    paper: '#F7E9EC', sheet: '#FFF8F9', ink: '#3D2A31', muted: '#9A7F87', rule: '#F0D9DF', accent: '#D35D7C', tint: '#FBE0E7',
    amber: '#E08A3C', surface: '#FFFFFF', inkRgb: '61, 42, 49', head: '#F2DCE1', headHover: '#EDD3D9', code: '#FCF1F3',
    accentHover: '#BC4D6A', idle: '#CDB8BE', faint: '#B8A2A9',
    glass: 'rgba(247, 233, 236, .55)', sel: 'rgba(211, 93, 124, .2)', ring: 'rgba(211, 93, 124, .38)', menu: 'rgba(255, 248, 249, .8)',
});

const WILD_DAY = {
    paper: '#E6EBD6', sheet: '#F6F4E9', ink: '#2E3326', muted: '#7A8068', rule: '#DAD6BF', accent: '#D9822B', tint: '#E3EAD0',
    amber: '#C2452D', surface: '#FFFDF6', inkRgb: '46, 51, 38', head: '#DCE3C8', headHover: '#D4DCBE', code: '#F0EEE0',
    accentHover: '#BF6F20', idle: '#B9BDA8', faint: '#A3A88F',
    glass: 'rgba(230, 235, 214, .55)', sel: 'rgba(127, 166, 90, .24)', ring: 'rgba(217, 130, 43, .38)', menu: 'rgba(246, 244, 233, .8)',
};
const WILD = {
    day: palette(WILD_DAY),
    dusk: palette({
        ...WILD_DAY, paper: '#EFE4D2', sheet: '#FAF1E6', rule: '#E6D7C0', tint: '#F1E2CF', head: '#E8DAC4', headHover: '#E2D2BA', code: '#F4EADB',
        glass: 'rgba(239, 228, 210, .55)', sel: 'rgba(217, 130, 43, .2)', menu: 'rgba(250, 241, 230, .8)',
    }),
    night: palette({
        paper: '#1C2530', sheet: '#141C25', ink: '#E4E8DA', muted: '#8B9686', rule: '#2A3540', accent: '#E89A45', tint: '#222F3C',
        amber: '#E86A50', surface: '#1B2530', inkRgb: '228, 232, 218', head: '#24303C', headHover: '#2A3744', code: '#18212B',
        accentHover: '#F0A85A', idle: '#4E5A63', faint: '#66727A',
        glass: 'rgba(28, 37, 48, .6)', sel: 'rgba(232, 154, 69, .22)', ring: 'rgba(232, 154, 69, .45)', menu: 'rgba(28, 37, 48, .82)',
        extra: { '--add': '#7FC08E', '--del': '#E8806F' },
    }),
};

/** The skins in the order settings shows them; `chip` is the swatch's CSS background. */
export const SKINS = [
    { id: 'moss', name: '苔绿', chip: 'linear-gradient(135deg, #FCFCFA 50%, #56735C 50%)' },
    { id: 'sakura', name: '樱花', chip: 'linear-gradient(135deg, #FFF8F9 50%, #D35D7C 50%)' },
    { id: 'wild', name: '旷野', chip: 'linear-gradient(135deg, #F6F4E9 33%, #7FA65A 33% 66%, #D9822B 66%)' },
];
const known = (id) => SKINS.some((k) => k.id === id);

function saved(storage) {
    try {
        const v = JSON.parse(storage.getItem(KEY) || 'null');
        return v && v.v === 1 ? v : {};
    } catch {
        return {};
    }
}

/** What is picked: { id, motion }. Motion starts off when the system asks for less motion and none was picked. */
export function readSkin(storage, reducedMotion) {
    const v = saved(storage);
    return {
        id: known(v.id) ? v.id : 'moss',
        motion: MOTIONS.includes(v.motion) ? v.motion : (reducedMotion ? 'off' : 'full'),
    };
}

function save(storage, next) {
    const v = saved(storage);
    storage.setItem(KEY, JSON.stringify({ v: 1, id: known(v.id) ? v.id : 'moss', ...(MOTIONS.includes(v.motion) ? { motion: v.motion } : {}), ...next }));
}

export function setSkin(storage, id) {
    if (known(id)) save(storage, { id });
}

export function setMotion(storage, motion) {
    if (MOTIONS.includes(motion)) save(storage, { motion });
}

/** 'day' from 6:00, 'dusk' from 17:00, 'night' from 19:00 (local time). */
export function timeOfDay(date) {
    const h = date.getHours();
    if (h >= 6 && h < 17) return 'day';
    if (h >= 17 && h < 19) return 'dusk';
    return 'night';
}

/** The CSS variables a skin sets at a time of day, and whether that look is dark. */
export function paletteFor(id, time) {
    if (id === 'sakura') return { vars: SAKURA, dark: false };
    if (id === 'wild') {
        const t = WILD[time] ? time : 'day';
        return { vars: WILD[t], dark: t === 'night' };
    }
    return { vars: {}, dark: false };
}
