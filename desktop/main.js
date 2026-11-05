// Happy for macOS: the web-mini client in its own window, plus the bits a
// Mac app is expected to have (menus, Dock badge, notifications, a window
// that hides on close and comes back from the Dock).
//
// The page is served from app://happy/, a standard secure scheme, so ES
// modules, crypto.subtle and localStorage behave as they do on https.

const { app, BrowserWindow, Menu, Notification, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = 'app://happy';
const isMac = process.platform === 'darwin';

// Packaged builds carry the page in ./web; in development it is ../web.
const WEB_ROOT = fs.existsSync(path.join(__dirname, 'web', 'index.html'))
    ? path.join(__dirname, 'web')
    : path.resolve(__dirname, '..', 'web');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([{
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

/** Map app://happy/<path> to a file under WEB_ROOT, never outside it. */
function resolveAsset(url) {
    const u = new URL(url);
    if (u.host !== 'happy') return null;
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.resolve(WEB_ROOT, '.' + rel);
    if (file !== WEB_ROOT && !file.startsWith(WEB_ROOT + path.sep)) return null;
    return file;
}

function serveAssets() {
    protocol.handle('app', async (req) => {
        const file = resolveAsset(req.url);
        if (!file) return new Response('Not found', { status: 404 });
        try {
            const body = await fs.promises.readFile(file);
            const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
            return new Response(body, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
        } catch {
            return new Response('Not found', { status: 404 });
        }
    });
}

// Some blob stores answer without CORS headers for an origin they do not
// know. The page only makes credential-less requests, so '*' is enough.
function relaxCors() {
    session.defaultSession.webRequest.onHeadersReceived((details, done) => {
        const headers = details.responseHeaders || {};
        const has = Object.keys(headers).some((k) => k.toLowerCase() === 'access-control-allow-origin');
        if (!has && /^https?:/.test(details.url)) headers['Access-Control-Allow-Origin'] = ['*'];
        done({ responseHeaders: headers });
    });
}

// ---------- Window state ----------

const stateFile = () => path.join(app.getPath('userData'), 'window.json');

function loadBounds() {
    try {
        const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
        if (b && b.width >= 820 && b.height >= 560) return b;
    } catch { /* first run */ }
    return { width: 1200, height: 800 };
}

let saveTimer = null;
function saveBounds(win) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
        try { fs.writeFileSync(stateFile(), JSON.stringify(win.getNormalBounds())); } catch { /* read-only */ }
    }, 400);
}

// ---------- Main window ----------

let win = null;
let quitting = false;

function send(channel, ...args) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function showWindow() {
    if (!win || win.isDestroyed()) { createWindow(); return; }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

function isAppUrl(url) {
    return url === ORIGIN || url.startsWith(ORIGIN + '/');
}

function createWindow() {
    const bounds = loadBounds();
    win = new BrowserWindow({
        ...bounds,
        minWidth: 820,
        minHeight: 560,
        title: 'Happy',
        show: false,
        backgroundColor: '#FCFCFA',
        ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 13 } } : {}),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
        },
    });
    win.once('ready-to-show', () => win.show());
    win.on('resize', () => saveBounds(win));
    win.on('move', () => saveBounds(win));

    // Mac convention: closing the window keeps the app (and its sync) alive.
    win.on('close', (e) => {
        if (isMac && !quitting) { e.preventDefault(); win.hide(); }
    });
    win.on('closed', () => { win = null; });

    // Links: decrypted images (blob:) open in a small viewer window, the rest
    // in the default browser. The app itself never navigates away.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('blob:' + ORIGIN)) {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    width: 900, height: 700, backgroundColor: '#1E1F1D', autoHideMenuBar: true,
                    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
                },
            };
        }
        if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        if (isAppUrl(url)) return;
        e.preventDefault();
        if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
    });

    win.loadURL(ORIGIN + '/index.html');
    return win;
}

// ---------- Page bridge ----------

const notifications = new Set(); // kept alive so their click handlers fire
// macOS only delivers notifications from properly signed apps; an ad-hoc
// build gets 'failed'. Remember it so the Dock bounce stands in for them.
let notifyError = null;

function bounceDock() {
    if (isMac && app.dock && !(win && win.isFocused())) app.dock.bounce('informational');
}

/** Show a system notification; resolves to 'shown', 'failed: <why>' or 'unsupported'. */
function showNotification({ title, body, id } = {}) {
    if (!Notification.isSupported()) { bounceDock(); return Promise.resolve('unsupported'); }
    if (notifyError) bounceDock();
    const n = new Notification({ title: String(title || 'Happy'), body: String(body || ''), silent: false });
    notifications.add(n);
    const done = () => notifications.delete(n);
    n.on('click', () => { showWindow(); if (id) send('desktop:open-session', String(id)); done(); });
    n.on('close', done);
    return new Promise((resolve) => {
        let settled = false;
        const settle = (result) => { if (!settled) { settled = true; resolve(result); } };
        n.once('show', () => { notifyError = null; settle('shown'); });
        n.once('failed', (_e, error) => {
            if (!notifyError) bounceDock();
            notifyError = String(error || 'unknown error');
            console.error('notification failed:', notifyError);
            done();
            settle('failed: ' + notifyError);
        });
        n.show();
        // Some refusals are silent: neither 'show' nor 'failed' arrives.
        setTimeout(() => {
            if (settled) return;
            if (!notifyError) bounceDock();
            notifyError = '系统没有回应（通知被静默丢弃）';
            settle('failed: ' + notifyError);
        }, 5000);
    });
}

const NOTIFICATION_SETTINGS = 'x-apple.systempreferences:com.apple.Notifications-Settings.extension';

async function testNotification() {
    const result = await showNotification({ title: 'Happy', body: '测试通知：看到这条，说明通知正常。' });
    if (result === 'shown') return;
    const { response } = await dialog.showMessageBox(win ?? undefined, {
        type: 'warning',
        message: '系统没有显示这条测试通知',
        detail: (result.startsWith('failed') ? `macOS 返回：${notifyError}\n\n` : `结果：${result}\n\n`)
            + '先到「系统设置 › 通知」里找 Happy，确认允许通知。\n\n'
            + '如果列表里没有 Happy：这个包只是 ad-hoc 签名，macOS 可能不给它发通知的权限。'
            + '这时 Dock 角标照常更新，有会话需要你时 Dock 图标会跳动提醒。',
        buttons: ['打开通知设置', '好'],
        defaultId: 1,
    });
    if (response === 0) shell.openExternal(NOTIFICATION_SETTINGS);
}

function bridge() {
    ipcMain.on('desktop:badge', (_e, count) => {
        const n = Math.max(0, Number(count) || 0);
        if (isMac && app.dock) app.dock.setBadge(n ? String(n) : '');
        else app.setBadgeCount(n);
    });
    ipcMain.on('desktop:attention', () => bounceDock());
    ipcMain.on('desktop:notify', (_e, note) => { showNotification(note); });
}

// ---------- Menus ----------

function buildMenu() {
    const command = (name) => () => { showWindow(); send('desktop:command', name); };
    const template = [
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about', label: '关于 Happy' },
                { type: 'separator' },
                { label: '设置…', accelerator: 'CmdOrCtrl+,', click: command('settings') },
                { type: 'separator' },
                { role: 'services', label: '服务' },
                { type: 'separator' },
                { role: 'hide', label: '隐藏 Happy' },
                { role: 'hideOthers', label: '隐藏其他' },
                { role: 'unhide', label: '全部显示' },
                { type: 'separator' },
                { role: 'quit', label: '退出 Happy' },
            ],
        }] : []),
        {
            label: '文件',
            submenu: [
                { label: '新建会话…', accelerator: 'CmdOrCtrl+N', click: command('new-session') },
                ...(isMac ? [] : [{ label: '设置…', accelerator: 'CmdOrCtrl+,', click: command('settings') }]),
                { type: 'separator' },
                isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
            ],
        },
        {
            label: '编辑',
            submenu: [
                { role: 'undo', label: '撤销' },
                { role: 'redo', label: '重做' },
                { type: 'separator' },
                { role: 'cut', label: '剪切' },
                { role: 'copy', label: '复制' },
                { role: 'paste', label: '粘贴' },
                { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
                { role: 'selectAll', label: '全选' },
            ],
        },
        {
            label: '显示',
            submenu: [
                { label: '切换侧栏', accelerator: 'CmdOrCtrl+B', click: command('toggle-sidebar') },
                { type: 'separator' },
                { role: 'reload', label: '重新载入' },
                { role: 'toggleDevTools', label: '开发者工具' },
                { type: 'separator' },
                { role: 'resetZoom', label: '实际大小' },
                { role: 'zoomIn', label: '放大' },
                { role: 'zoomOut', label: '缩小' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: '切换全屏' },
            ],
        },
        {
            role: 'windowMenu',
            label: '窗口',
            submenu: [
                { role: 'minimize', label: '最小化' },
                { role: 'zoom', label: '缩放' },
                { label: '显示主窗口', accelerator: 'CmdOrCtrl+0', click: () => showWindow() },
                ...(isMac ? [{ type: 'separator' }, { role: 'front', label: '前置全部窗口' }] : []),
            ],
        },
        {
            role: 'help',
            label: '帮助',
            submenu: [
                { label: '发送测试通知', click: () => testNotification() },
                ...(isMac ? [{ label: '打开通知设置…', click: () => shell.openExternal(NOTIFICATION_SETTINGS) }] : []),
                { type: 'separator' },
                { label: 'Happy 官网', click: () => shell.openExternal('https://happy.engineering') },
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Lifecycle ----------

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.setName('Happy');
    app.on('second-instance', () => showWindow());
    app.on('before-quit', () => { quitting = true; });
    app.on('activate', () => showWindow());
    app.on('window-all-closed', () => { if (!isMac) app.quit(); });
    app.whenReady().then(() => {
        // build.mjs records which commit of the page went in; dev runs have none.
        let info = null;
        try { info = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')); } catch { /* dev */ }
        const version = info ? `${info.commit}${info.dirty ? '+改动' : ''} · ${info.builtAt.slice(0, 10)}` : '开发版';
        app.setAboutPanelOptions({ applicationName: 'Happy', applicationVersion: app.getVersion(), version, copyright: 'happy-web-mini' });
        serveAssets();
        relaxCors();
        bridge();
        buildMenu();
        createWindow();
    });
}

module.exports = { resolveAsset, WEB_ROOT, ORIGIN };
