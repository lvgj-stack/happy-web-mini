// Smoke test: `npm run smoke` (on Linux: xvfb-run -a npx electron --no-sandbox smoke.js).
// Starts the real app, checks the page loaded cleanly through app://happy,
// that the bridge is there, that the asset protocol stays inside the web
// root, and saves screenshots of the sign-in page and the signed-in layout
// (with the Mac title-bar class forced on, so it can be checked off a Mac).
const { app, ipcMain, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { resolveAsset, WEB_ROOT } = require('./main.js');

const out = process.env.SMOKE_OUT || path.join(__dirname, 'smoke-out');
fs.mkdirSync(out, { recursive: true });
const problems = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };

check(resolveAsset('app://happy/') === path.join(WEB_ROOT, 'index.html'), 'root serves index.html');
const inside = (f) => f === null || f.startsWith(WEB_ROOT + path.sep);
check(inside(resolveAsset('app://happy/%2e%2e/%2e%2e/etc/passwd')), 'encoded .. stays inside');
check(inside(resolveAsset('app://happy/..%2f..%2f..%2fetc%2fpasswd')), 'encoded slashes stay inside');
check(inside(resolveAsset('app://happy/%2e%2e/desktop/main.js')), 'shell files are not served');
check(resolveAsset('app://evil/index.html') === null, 'other hosts are refused');

app.on('browser-window-created', (_e, win) => {
    const errors = [];
    win.webContents.on('console-message', (ev) => { if (ev.level === 'error' || ev.level === 'warning') errors.push(ev.message); });
    win.webContents.once('did-finish-load', async () => {
        await new Promise((r) => setTimeout(r, 1500));
        const wc = win.webContents;
        const probe = await wc.executeJavaScript(`({
            bridge: typeof window.happyDesktop?.notify === 'function',
            secure: window.isSecureContext,
            subtle: !!crypto.subtle,
            login: !document.getElementById('login').hidden,
            qr: !!document.querySelector('#login svg, #login img, #login canvas, #login-qr *'),
            origin: location.origin,
        })`);
        check(probe.bridge, 'window.happyDesktop is exposed');
        check(probe.secure && probe.subtle, 'secure context with crypto.subtle');
        check(probe.login, 'sign-in page shows');
        check(probe.origin === 'app://happy', 'origin is app://happy');
        check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
        fs.writeFileSync(path.join(out, 'login.png'), (await wc.capturePage()).toPNG());

        // QR sign-in talks to the real server from app://happy (CORS, fetch, nacl).
        await wc.executeJavaScript(`document.getElementById('login-qr').click()`);
        let qr = false;
        for (let i = 0; i < 20 && !qr; i++) {
            await new Promise((r) => setTimeout(r, 500));
            qr = await wc.executeJavaScript(`!!document.querySelector('#qr svg, #qr img, #qr table, #qr canvas')`);
        }
        const loginError = await wc.executeJavaScript(`document.getElementById('login-error').textContent`);
        check(qr && !loginError, `QR sign-in reaches the server${loginError ? ': ' + loginError : ''}`);
        fs.writeFileSync(path.join(out, 'qr.png'), (await wc.capturePage()).toPNG());

        // Signed-in layout with fake rows, Mac class on.
        await wc.executeJavaScript(`(() => {
            document.body.classList.add('desktop-mac');
            document.getElementById('login').hidden = true;
            document.getElementById('app').hidden = false;
            const list = document.getElementById('list');
            list.innerHTML = '<section class="machine"><div class="rows"><div class="project">' +
              ['修复登录超时', '重构会话列表', '写 Mac 打包脚本'].map((t, i) =>
                '<button class="row' + (i === 0 ? ' selected' : i === 1 ? ' unread' : '') + '"><span class="title"><span class="name">' + t + '</span></span><span class="sub"><span>happy</span></span></button>').join('') +
              '</div></div></section>';
            document.getElementById('chat-title').textContent = '写 Mac 打包脚本';
            document.getElementById('chat-sub').innerHTML = '<span>mac-mini</span><span>~/code/happy</span><span>在线</span>';
            document.getElementById('composer').hidden = false;
            document.getElementById('archive').hidden = false;
        })()`);
        await new Promise((r) => setTimeout(r, 300));
        fs.writeFileSync(path.join(out, 'app.png'), (await wc.capturePage()).toPNG());

        // Bridge: page -> app.
        const got = {};
        ipcMain.on('desktop:badge', (_e, n) => { got.badge = n; });
        ipcMain.on('desktop:notify', (_e, n) => { got.notify = n; });
        await wc.executeJavaScript(`window.happyDesktop.setBadge(3); window.happyDesktop.notify({ id: 'x', title: 't', body: 'b' })`);
        await new Promise((r) => setTimeout(r, 300));
        check(got.badge === 3 && got.notify?.id === 'x', 'badge and notification reach the app');

        // Menus: app -> page.
        const items = [];
        const walk = (m) => m.items.forEach((i) => { items.push(i); if (i.submenu) walk(i.submenu); });
        walk(Menu.getApplicationMenu());
        const byKey = (k) => items.find((i) => i.accelerator === k);
        check(['CmdOrCtrl+N', 'CmdOrCtrl+,', 'CmdOrCtrl+B'].every(byKey) && items.some((i) => i.role === 'paste'), 'menus have New, Settings, Sidebar and Edit');
        byKey('CmdOrCtrl+B').click();
        await new Promise((r) => setTimeout(r, 200));
        check(await wc.executeJavaScript(`document.body.classList.contains('side-collapsed')`), 'View > Toggle Sidebar collapses the sidebar');
        byKey('CmdOrCtrl+B').click();
        byKey('CmdOrCtrl+,').click();
        await new Promise((r) => setTimeout(r, 200));
        check(await wc.executeJavaScript(`document.body.classList.contains('in-settings')`), 'Settings… opens settings');
        const notify = await wc.executeJavaScript(`({ shown: !document.getElementById('notify-section').hidden && !!document.getElementById('notify-section').offsetParent, on: document.getElementById('notify-toggle').checked, enabled: !document.getElementById('notify-toggle').disabled })`);
        check(notify.shown && notify.on && notify.enabled, 'settings show the notification switch, on by default');
        await new Promise((r) => setTimeout(r, 300));
        const about = await wc.executeJavaScript(`document.getElementById('about-version').textContent`);
        check(!!about, `settings show the version (${about})`);
        await wc.executeJavaScript(`(() => { for (const e of document.querySelectorAll('*')) if (e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = e.scrollHeight; })()`);
        await new Promise((r) => setTimeout(r, 200));
        fs.writeFileSync(path.join(out, 'settings.png'), (await wc.capturePage()).toPNG());
        console.log(`screenshots in ${out}`);
        app.exit(problems.length ? 1 : 0);
    });
});
setTimeout(() => { console.log('FAIL timed out'); app.exit(1); }, 30000);
