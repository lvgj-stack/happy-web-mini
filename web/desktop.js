// What the page does when it runs inside the Mac app (desktop/): the Dock
// badge counts sessions that want you (finished and unread, or waiting for an
// answer), and a notification says so when one starts wanting you while the
// window is not in front. In a browser the count goes in the tab title instead
// (app.js) and notifications need the browser's permission. Both have the same
// on/off switch in settings: on by default in the Mac app, off in a browser.

/**
 * @param {object|undefined} bridge window.happyDesktop from desktop/preload.js
 * @param {object|null} notifier where notifications go without the Mac app: { notify(note), onOpenSession(fn) }
 */
export function createDesktop(bridge, notifier = null) {
    const notify = bridge ?? notifier;
    let unread = null; // Set of ids last time, null before the first look
    let asking = null;
    let badge = 0;

    function setBadge(n) {
        if (n === badge) return;
        badge = n;
        bridge?.setBadge(n);
    }

    return {
        active: !!bridge,
        platform: bridge?.platform ?? null,

        /**
         * Called with every session the list shows, each time it renders.
         * @param {object[]} sessions
         * @param {{ isUnread(s): boolean, isAsking(s): boolean, title(s): string, focused: boolean }} how
         * @returns {{ badge: number, notified: { id: string, kind: 'asking'|'done' }[] }}
         */
        update(sessions, how) {
            const nowUnread = new Set();
            const nowAsking = new Set();
            for (const s of sessions) {
                if (how.isAsking(s)) nowAsking.add(s.id);
                else if (how.isUnread(s)) nowUnread.add(s.id);
            }
            setBadge(nowUnread.size + nowAsking.size);

            const notified = [];
            // The first look only learns what is already there: opening the
            // app does not replay old news.
            if (unread && asking && !how.focused) {
                for (const s of sessions) {
                    if (nowAsking.has(s.id) && !asking.has(s.id)) notified.push({ s, kind: 'asking' });
                    else if (nowUnread.has(s.id) && !unread.has(s.id)) notified.push({ s, kind: 'done' });
                }
            }
            if (notificationsOn()) {
                const silent = !notifySoundOn();
                for (const { s, kind } of notified) {
                    notify?.notify({ id: s.id, title: how.title(s), body: kind === 'asking' ? '在等你回答' : '回复完成', silent });
                }
                if (notified.some((n) => n.kind === 'asking')) bridge?.attention();
            }
            unread = nowUnread;
            asking = nowAsking;
            return { badge, notified: notified.map(({ s, kind }) => ({ id: s.id, kind })) };
        },

        /** Signed out: no badge, and the next account starts fresh. */
        reset() {
            unread = null;
            asking = null;
            setBadge(0);
        },

        onCommand(fn) { bridge?.onCommand(fn); },
        onOpenSession(fn) { notify?.onOpenSession(fn); },
    };
}

// ---------- Browser notifications ----------

const NOTIFY_KEY = 'happy.notify';
const inApp = () => !!globalThis.window?.happyDesktop;

/** Can this page show system notifications at all (needs https or localhost)? The Mac app always can. */
export function notificationsSupported() {
    if (inApp()) return true;
    return typeof Notification !== 'undefined' && globalThis.isSecureContext !== false;
}

/** On in settings (Mac app: unless turned off; browser: turned on and allowed). */
export function notificationsOn() {
    if (inApp()) return localStorage.getItem(NOTIFY_KEY) !== '0';
    return notificationsSupported() && localStorage.getItem(NOTIFY_KEY) === '1' && Notification.permission === 'granted';
}

const SOUND_KEY = 'happy.notifySound';

/** Notifications play the system sound unless turned off in settings (Mac app only; on by default). */
export function notifySoundOn() {
    return localStorage.getItem(SOUND_KEY) !== '0';
}

/** Tell the Mac app whether notifications make a sound (its own test notification follows it too). */
export function setNotifySound(on) {
    if (on) localStorage.removeItem(SOUND_KEY); else localStorage.setItem(SOUND_KEY, '0');
    globalThis.window?.happyDesktop?.setNotifySound?.(on);
}

/**
 * Turn browser notifications on or off. Turning on asks the browser for
 * permission first; resolves to what it ended up as.
 * @returns {Promise<'on'|'off'|'denied'|'unsupported'>}
 */
export async function setNotifications(on) {
    if (inApp()) { localStorage.setItem(NOTIFY_KEY, on ? '1' : '0'); return on ? 'on' : 'off'; }
    if (!on) { localStorage.removeItem(NOTIFY_KEY); return 'off'; }
    if (!notificationsSupported()) return 'unsupported';
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') { localStorage.removeItem(NOTIFY_KEY); return 'denied'; }
    localStorage.setItem(NOTIFY_KEY, '1');
    return 'on';
}

/** System notifications from the page itself; a click brings the tab forward and opens the session. */
export function browserNotifier() {
    let open = null;
    return {
        notify({ id, title, body }) {
            if (!notificationsOn()) return;
            const n = new Notification(title || 'Happy', { body, tag: id, icon: 'favicon.svg' });
            n.onclick = () => { window.focus(); open?.(id); n.close(); };
        },
        onOpenSession(fn) { open = fn; },
    };
}

const bridge = globalThis.window?.happyDesktop;
export const desktop = createDesktop(bridge, bridge || !globalThis.window ? null : browserNotifier());
bridge?.setNotifySound?.(notifySoundOn()); // the app starts with sound on; bring it in line with settings
