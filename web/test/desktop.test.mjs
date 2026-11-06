// node --test: the Mac-app/browser glue in desktop.js (badge, notifications, switch).
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const calls = [];
const bridge = {
    platform: 'darwin',
    setBadge: (n) => calls.push(['badge', n]),
    notify: (n) => calls.push(['notify', n.id, n.body]),
    attention: () => calls.push(['attention']),
    setNotifySound: (on) => calls.push(['sound', on]),
    onCommand() {}, onOpenSession() {},
};
globalThis.window = { happyDesktop: bridge };
const { createDesktop, notificationsOn, notifySoundOn, setNotifications, setNotifySound } = await import('../desktop.js');

const how = (unread, asking, focused = false) => ({
    isUnread: (s) => unread.includes(s.id), isAsking: (s) => asking.includes(s.id), title: (s) => s.id.toUpperCase(), focused,
});
const S = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
beforeEach(() => { calls.length = 0; store.clear(); });

test('first look sets the badge and replays nothing', () => {
    const d = createDesktop(bridge);
    assert.deepEqual(d.update(S, how(['a'], ['b'])), { badge: 2, notified: [] });
    assert.deepEqual(calls, [['badge', 2]]);
});

test('new unread / asking notify while unfocused; asking bounces the Dock', () => {
    const d = createDesktop(bridge);
    d.update(S, how(['a'], ['b']));
    calls.length = 0;
    d.update(S, how(['a'], ['b']));
    assert.deepEqual(calls, [], 'no change sends nothing');
    assert.deepEqual(d.update(S, how(['a', 'c'], ['b'])).notified, [{ id: 'c', kind: 'done' }]);
    assert.deepEqual(d.update(S, how(['c'], ['a', 'b'])).notified, [{ id: 'a', kind: 'asking' }]);
    assert.deepEqual(calls, [['badge', 3], ['notify', 'c', '回复完成'], ['notify', 'a', '在等你回答'], ['attention']]);
});

test('focused: badge changes, no notification; asking+unread counts once', () => {
    const d = createDesktop(bridge);
    d.update(S, how(['c'], []));
    d.update(S, how(['c', 'b'], [], true));
    assert.deepEqual(calls, [['badge', 1], ['badge', 2]]);
    assert.equal(d.update(S, how(['a'], ['a'], true)).badge, 1);
});

test('Mac app: notifications on by default, the settings switch turns them off but not the badge', async () => {
    assert.equal(notificationsOn(), true);
    assert.equal(await setNotifications(false), 'off');
    assert.equal(notificationsOn(), false);
    const d = createDesktop(bridge);
    d.update(S, how([], []));
    assert.equal(d.update(S, how(['a'], ['b'])).notified.length, 2, 'still worked out');
    assert.deepEqual(calls, [['badge', 2]], 'but only the badge went out');
    assert.equal(await setNotifications(true), 'on');
    assert.equal(notificationsOn(), true);
});

test('reset clears the badge and starts fresh', () => {
    const d = createDesktop(bridge);
    d.update(S, how(['a'], []));
    d.reset();
    assert.deepEqual(calls.at(-1), ['badge', 0]);
    assert.deepEqual(d.update(S, how(['a', 'b'], [])).notified, []);
});

test('browser (no bridge): counts the badge for the tab title, sends nothing to the app', () => {
    const web = createDesktop(undefined);
    assert.equal(web.active, false);
    assert.equal(web.update(S, how(['a'], [])).badge, 1);
    assert.deepEqual(calls, []);
});

test('Mac app: notifications make a sound by default; the switch silences them and tells the app', () => {
    const notes = [];
    const d = createDesktop({ ...bridge, notify: (n) => notes.push(n) });
    d.update(S, how([], []));
    d.update(S, how(['a'], []));
    assert.equal(notifySoundOn(), true);
    assert.equal(notes[0].silent, false);
    setNotifySound(false);
    assert.equal(notifySoundOn(), false);
    assert.deepEqual(calls.at(-1), ['sound', false], 'the app hears it (for its test notification)');
    d.update(S, how(['a', 'b'], []));
    assert.equal(notes[1].silent, true);
    setNotifySound(true);
    assert.equal(notifySoundOn(), true);
    assert.deepEqual(calls.at(-1), ['sound', true]);
});
