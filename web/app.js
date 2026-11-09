import {
    accountKeys, authChallenge, b64, b64url, decryptJSON, encryptJSON,
    openAnonymous, parseSecretKey, unb64, unwrapDataKey, uuid,
} from './crypto.js';
import { io } from './node_modules/socket.io-client/dist/socket.io.esm.min.js';
import { DEFAULT_AGENTS, agentModelOptions, currentEffort, currentModelKey, effortName, effortOptions, isRig, modelMeta, modelOptions } from './models.js';
import { defaultsFor, loadDefaults, saveDefault } from './defaults.js';
import { renderInlineMarkdown, renderMarkdown } from './markdown.js';
import { addCopyButtons, copyText, handleCopyClicks } from './clipboard.js';
import { openMenu } from './contextmenu.js';
import { answerCall, canSubmit, declineCall, pendingQuestions, toggle } from './questions.js';
import { approvalCall, canApproveForSession, describeApproval, pendingApprovals } from './approvals.js';
import { agentPermissionOptions, permissionOptions } from './permissions.js';
import { fileEvent, imageUrl, prepareImage, rememberImage, uploadImage } from './attachments.js';
import { desktop, notificationsOn, notificationsSupported, notifySoundOn, setNotifications, setNotifySound } from './desktop.js';
import { describeTool, formatDuration, iconSvg } from './tools.js';
import { commandText, parseLocalCommand } from './localCommand.js';
import { backgroundStops, backgroundText, backgroundTracker } from './background.js';
import { resumeAvailability, resumeFallback } from './resume.js';
import { messageTime } from './time.js';
import { onServerScheme } from './serverUrl.js';
import { onFirstLine, onLastLine, promptHistory, stepHistory } from './history.js';
import { createWorktree, listWorktrees, removeWorktree, repoOf, worktreeOf } from './worktree.js';
import { activeSlash, applyCommand, searchCommands } from './commands.js';
import { capturedText, rowText, usageRows, usageTooltip } from './usage.js';
import { contextLine, contextUsage } from './context.js';
import { fitToViewport } from './viewport.js';

fitToViewport();

const nacl = window.nacl;
const $ = (id) => document.getElementById(id);
const DEFAULT_SERVER = 'https://api.cluster-fluster.com';
const WORKTREE_MARKER = '/.dev/worktree/';
const ARCHIVED_PAGE = 30;

const state = {
    server: localStorage.getItem('happy.server') || DEFAULT_SERVER,
    token: localStorage.getItem('happy.token'),
    keys: null,
    sessions: new Map(),     // id -> { id, dataKey, meta, metadataVersion, active, activeAt, updatedAt }
    syncedAt: 0,             // highest server updatedAt seen, for changedSince
    current: null,
    threads: new Map(),      // session id -> { el, afterSeq, seen, scrollTop }: opened chats, kept rendered
    messageTimer: null,
    listTimer: null,
    collapsed: new Set(JSON.parse(localStorage.getItem('happy.collapsed') || '[]')),
    archivedOpen: localStorage.getItem('happy.archivedOpen') === '1', // the 已归档 group; closed by default
    archivedShown: ARCHIVED_PAGE, // how many archived rows the open group lists
    machines: null,          // the account's computers, for 恢复会话 (see refreshMachines)
    machinesAt: 0,
    machinesLoading: null,
    listSignature: null,
    seen: JSON.parse(localStorage.getItem('happy.seen') || '{}'), // session id -> newest seq seen in this browser
    drafts: new Map(),       // session id -> unsent composer text
    pendingImages: new Map(), // session id -> [{ id, image | null, error? , promise }]: picked, not sent yet
    askDrafts: new Map(),    // "sessionId:questionSetId" -> { questionId: { options, custom } }
    askSent: new Set(),      // question sets answered here, hidden until agentState catches up
    askSignature: null,
    thinkingNode: null,
    browse: null,            // ↑ history in the composer: { sessionId, index, draft, text } while walking it
};

// ---------- HTTP ----------

async function api(method, path, body, auth = true) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (auth) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(state.server + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 && auth) { logout(); throw new Error('登录已失效，请重新登录'); }
    if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
    return res.json();
}
/** The bearer token, only for URLs on the Happy server itself (never a presigned third party). */
api.authHeaderFor = (url) => (new URL(url).origin === new URL(state.server).origin ? { Authorization: `Bearer ${state.token}` } : {});
/** A URL the server built for itself, on our https when it says http (see serverUrl.js). */
api.ownUrl = (url) => onServerScheme(url, state.server);

function notice(text) {
    const el = $('notice');
    el.textContent = text;
    clearTimeout(notice.timer);
    notice.timer = setTimeout(() => { el.textContent = ''; }, 6000);
}

// ---------- Login ----------

function readServer() {
    state.server = $('server').value.trim().replace(/\/$/, '') || DEFAULT_SERVER;
}

async function finishLogin(secret, token) {
    state.keys = await accountKeys(secret);
    state.token = token;
    localStorage.setItem('happy.secret', b64(secret));
    localStorage.setItem('happy.token', token);
    localStorage.setItem('happy.server', state.server);
    showApp();
}

async function loginWithSecret() {
    $('login-error').textContent = '';
    try {
        readServer();
        const secret = parseSecretKey($('secret').value);
        const keys = await accountKeys(secret);
        const { token } = await api('POST', '/v1/auth', authChallenge(keys), false);
        await finishLogin(secret, token);
    } catch (e) {
        $('login-error').textContent = e.message;
    }
}

let qrAbort = null;
async function loginWithQR() {
    $('login-error').textContent = '';
    readServer();
    qrAbort?.abort();
    const abort = (qrAbort = new AbortController());
    const kp = nacl.box.keyPair();
    const publicKey = b64(kp.publicKey);
    try {
        await api('POST', '/v1/auth/account/request', { publicKey }, false);
    } catch (e) {
        $('login-error').textContent = e.message;
        return;
    }
    const qr = window.qrcode(0, 'M');
    qr.addData('happy:///account?' + b64url(kp.publicKey));
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 0 }) +
        '<p>在手机上打开已登录的 Happy，选择关联新设备，扫描这个二维码。</p>';
    $('login-qr').hidden = true;
    while (!abort.signal.aborted) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
            const r = await api('POST', '/v1/auth/account/request', { publicKey }, false);
            if (r.state !== 'authorized') continue;
            const secret = openAnonymous(unb64(r.response), kp.secretKey);
            if (!secret || secret.length !== 32) throw new Error('手机返回的密钥无法解开，请重新扫码');
            $('qr').innerHTML = '';
            $('login-qr').hidden = false;
            await finishLogin(secret, r.token);
            return;
        } catch (e) {
            $('login-error').textContent = e.message;
            $('login-qr').hidden = false;
            return;
        }
    }
}

function logout() {
    localStorage.removeItem('happy.secret');
    localStorage.removeItem('happy.token');
    clearInterval(state.messageTimer);
    clearInterval(state.listTimer);
    socket?.disconnect();
    socket = null;
    Object.assign(state, { keys: null, token: null, current: null, sessions: new Map(), threads: new Map(), syncedAt: 0, listSignature: null, askSignature: null, drafts: new Map() });
    $('app').hidden = true;
    $('login').hidden = false;
    desktop.reset();
    state.badge = 0;
    applyBrand();
}

// ---------- Sessions ----------

async function ingest(raw) {
    const known = state.sessions.get(raw.id);
    const dataKey = known?.dataKey ?? unwrapDataKey(state.keys, raw.dataEncryptionKey);
    if (!dataKey) return; // legacy secret-box sessions are not supported
    const meta = (raw.metadata && (await decryptJSON(dataKey, raw.metadata))) || {};
    const agentState = raw.agentState ? await decryptJSON(dataKey, raw.agentState) : null;
    const next = {
        id: raw.id, dataKey, meta, agentState,
        metadataVersion: raw.metadataVersion,
        agentStateVersion: raw.agentStateVersion ?? 0,
        active: raw.active,
        activeAt: raw.activeAt ?? raw.updatedAt,
        updatedAt: raw.updatedAt,
        createdAt: raw.createdAt ?? 0,
        seq: Math.max(raw.seq ?? 0, known?.seq ?? 0),
    };
    // Keep the object identity so an open chat follows its updates.
    const grew = known && next.seq > (known.seq ?? 0);
    if (known) Object.assign(known, next); else state.sessions.set(raw.id, next);
    const s = known ?? next;
    if (grew) sessionChanged(s);
    // Just loaded: whether it is working is only known at its first keepalive (≤2s).
    else if (!known) { s.changedAt = Date.now() - UNREAD_SETTLE + THINKING_MUTE; setTimeout(() => renderList(), THINKING_MUTE + 50); }
    if (!(raw.id in state.seen)) { state.seen[raw.id] = next.seq; saveSeen(); } // first sight: nothing to flag yet
}

async function syncSessions() {
    const since = state.syncedAt;
    let cursor = null;
    do {
        const q = new URLSearchParams({ limit: '200' });
        if (cursor) q.set('cursor', cursor);
        if (since) q.set('changedSince', String(since));
        const page = await api('GET', `/v2/sessions?${q}`);
        for (const raw of page.sessions) {
            state.syncedAt = Math.max(state.syncedAt, raw.updatedAt);
            await ingest(raw);
        }
        cursor = page.hasNext ? page.nextCursor : null;
    } while (cursor);
    renderList();
    renderHead();
    renderAsk();
    renderUsage();
}

const isArchived = (s) => s.meta.lifecycleState === 'archived';

function sessionTitle(s) {
    const kind = kindOf(s);
    if (kind === 'bot' && s.meta.bot.name) return s.meta.bot.name;
    if (kind === 'task' && s.meta.task.name) return s.meta.task.name;
    return s.meta.summary?.text || s.meta.name || s.meta.path?.split('/').filter(Boolean).pop() || '未命名会话';
}

function place(s) {
    const path = (s.meta.path || '').trim();
    const at = path.indexOf(WORKTREE_MARKER);
    const projectPath = at >= 0 ? path.slice(0, at) : path;
    const worktree = at >= 0 ? path.slice(at + WORKTREE_MARKER.length).split('/')[0] : null;
    const project = projectPath.split('/').filter(Boolean).pop() || '';
    const home = s.meta.homeDir;
    const shortPath = home && path.startsWith(home) ? '~' + path.slice(home.length) : path;
    return { projectPath, project, worktree, shortPath };
}

const machineKey = (s) => s.meta.machineId || s.meta.host || 'unknown';
const ONLINE_WINDOW = 15 * 60 * 1000; // same as GET /v2/sessions/active
const isOnline = (s) => s.active && !isArchived(s) && Date.now() - s.activeAt < ONLINE_WINDOW;
const byName = (a, b) => a.name.localeCompare(b.name, 'zh');

/**
 * What a session is, as the official apps read it: a bot (`metadata.bot`,
 * Happy Agent), a task (`metadata.task`; a session naming both is a bot),
 * or a chat in a project's checkout.
 */
function kindOf(s) {
    if (s.meta.bot && typeof s.meta.bot === 'object') return 'bot';
    if (s.meta.task && typeof s.meta.task === 'object') return 'task';
    return 'chat';
}

/**
 * The project and checkout a chat runs in: Happy Agent's own project and
 * workspace when it reports them, else the directory, with `.dev/worktree/*`
 * under the repository it belongs to. `workspaceId` is '' for the project's own checkout.
 */
function checkout(s) {
    const project = s.meta.project;
    if (project?.id) {
        const ws = s.meta.workspace;
        return {
            projectId: 'rig:' + project.id, projectName: project.name || project.id, projectTitle: project.name || project.id,
            workspaceId: ws?.id || '', workspaceName: ws?.id ? ws.name || ws.id : null,
        };
    }
    const p = place(s);
    const home = s.meta.homeDir?.replace(/\/+$/, '');
    const isHome = !p.projectPath || p.projectPath.replace(/\/+$/, '') === home;
    const shortProject = home && p.projectPath.startsWith(home) ? '~' + p.projectPath.slice(home.length) : p.projectPath;
    return {
        projectId: 'path:' + p.projectPath, projectName: isHome ? '~' : p.project || p.projectPath, projectTitle: shortProject || '~',
        workspaceId: p.worktree ? p.projectPath + WORKTREE_MARKER + p.worktree : '', workspaceName: p.worktree,
    };
}

const newestFirst = (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id);
/** By a stored order key (the person's own order in the apps), then newest first. */
const byOrderKey = (key) => (a, b) => {
    const x = key(a) ?? '￿', y = key(b) ?? '￿';
    return x < y ? -1 : x > y ? 1 : newestFirst(a, b);
};

/**
 * Online sessions: computer › bots, tasks, then chats in a tree of
 * project › (its own chats, then worktree › chats). Ordered by things that do
 * not change while a session runs (names, order keys, creation time), so
 * heartbeats never reshuffle the list. `sessions` is the order rows show in.
 */
function groupLive(sessions) {
    const machines = new Map();
    for (const s of sessions) {
        const key = machineKey(s);
        if (!machines.has(key)) machines.set(key, { key, name: s.meta.host || '未知电脑', bots: [], tasks: [], projects: new Map() });
        const m = machines.get(key);
        const kind = kindOf(s);
        if (kind === 'bot') { m.bots.push(s); continue; }
        if (kind === 'task') { m.tasks.push(s); continue; }
        const c = checkout(s);
        if (!m.projects.has(c.projectId)) m.projects.set(c.projectId, { id: c.projectId, name: c.projectName, title: c.projectTitle, own: [], worktrees: new Map() });
        const p = m.projects.get(c.projectId);
        if (!c.workspaceId) { p.own.push(s); continue; }
        if (!p.worktrees.has(c.workspaceId)) p.worktrees.set(c.workspaceId, { id: c.workspaceId, name: c.workspaceName, sessions: [] });
        p.worktrees.get(c.workspaceId).sessions.push(s);
    }
    return [...machines.values()]
        .sort((a, b) => byName(a, b) || a.key.localeCompare(b.key))
        .map((m) => {
            const bots = m.bots.sort(byOrderKey((s) => s.meta.bot.orderKey));
            const tasks = m.tasks.sort(byOrderKey((s) => s.meta.task.orderKey));
            const projects = [...m.projects.values()]
                .sort((a, b) => byName(a, b) || a.id.localeCompare(b.id))
                .map((p) => {
                    const own = p.own.sort(newestFirst);
                    const worktrees = [...p.worktrees.values()]
                        .sort((a, b) => byName(a, b) || a.id.localeCompare(b.id))
                        .map((w) => ({ ...w, sessions: w.sessions.sort(newestFirst) }));
                    return { ...p, own, worktrees, sessions: [...own, ...worktrees.flatMap((w) => w.sessions)] };
                });
            const all = [...bots, ...tasks, ...projects.flatMap((p) => p.sessions)];
            return { key: m.key, name: m.name, bots, tasks, projects, sessions: all, count: all.length };
        });
}

/** The online sessions in the order the list shows them. */
function liveSessions() {
    return groupLive([...state.sessions.values()].filter((s) => s.meta.isSideChat !== true && isOnline(s)))
        .flatMap((m) => m.sessions);
}

const archivedAt = (s) => s.meta.lifecycleStateSince || s.updatedAt || 0;

/** Archived sessions, most recently archived first. */
function archivedSessions() {
    return [...state.sessions.values()]
        .filter((s) => s.meta.isSideChat !== true && isArchived(s))
        .sort((a, b) => archivedAt(b) - archivedAt(a) || a.id.localeCompare(b.id));
}

/** 今天 14:05 / 昨天 / 3月2日 / 2025年3月2日 */
function shortDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const now = new Date();
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff === 0) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (diff === 1) return '昨天';
    if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

/** Icon + label on a button; `busy` swaps the icon for a spinner. */
function setButton(button, icon, text, busy = false) {
    button.replaceChildren();
    if (busy) button.append(el('span', 'spin'));
    else if (icon) button.insertAdjacentHTML('beforeend', iconSvg(icon));
    if (text) button.append(el('span', 'label', text));
}

/** A waiting line: spinner + text. */
function waitingNode(className, text) {
    const node = el('p', className);
    node.append(el('span', 'spin'), el('span', 'label', text));
    return node;
}

function groupHead(name, count, collapsed, onToggle, icon = 'computer', sessions = []) {
    const head = el('button', 'group-head');
    head.setAttribute('aria-expanded', String(!collapsed));
    // Folded, a dot says a session inside waits for an answer or is unread (as on a project).
    if (sessions.some((s) => waitingSets(s).length)) head.classList.add('asking');
    else if (sessions.some(isUnread)) head.classList.add('unread');
    head.insertAdjacentHTML('beforeend', iconSvg(icon));
    head.append(el('span', 'name', name), el('span', 'count', String(count)), el('span', 'mark'), el('span', 'chev'));
    head.onclick = onToggle;
    return head;
}

/** 等你批准 when all it waits on are tool approvals, else 等你回答. */
const waitingLabel = (s) => (waitingSets(s).every((set) => set.via === 'approval') ? '等你批准' : '等你回答');

/** Between turns, but a subagent or command it started in the background still runs (known once opened here). */
function inBackground(s) {
    return !s.thinking && !!s.active && !isArchived(s) && (state.threads.get(s.id)?.background?.tasks().length ?? 0) > 0;
}

/** In a turn, or something it started still runs in the background: the row spins. */
const isWorking = (s) => !!s.thinking || inBackground(s);

/** 等你回答 > 正在工作 / 后台运行中 > 闲置: what the row's icon says. */
function rowStatus(s) {
    if (waitingSets(s).length) return waitingLabel(s);
    if (s.thinking) return '正在工作';
    if (inBackground(s)) return '后台运行中';
    return isUnread(s) ? '已完成，还没看' : '闲置';
}

// ---------- Read / unread ----------
// A session is unread when it is idle and has messages newer than the newest
// one seen here. Kept per browser (like the phone app, it is not synced).

let seenTimer = null;
function saveSeen() {
    clearTimeout(seenTimer);
    seenTimer = setTimeout(() => {
        const known = {};
        for (const [id, seq] of Object.entries(state.seen)) if (state.sessions.has(id)) known[id] = seq;
        state.seen = known;
        localStorage.setItem('happy.seen', JSON.stringify(known));
    }, 300);
}

/** How long a session must sit still before it counts as done: longer than the
 *  gap between two turns or a message and the agent picking it up (keepalives come every 2s). */
const UNREAD_SETTLE = 6000;
/** After a turn ends, how long a lagging "thinking" keepalive is ignored. */
const THINKING_MUTE = 2500;

/** Has messages newer than the newest one seen in this browser. */
function hasUnseen(s) {
    return !isArchived(s) && !waitingSets(s).length && (s.seq ?? 0) > (state.seen[s.id] ?? Infinity);
}

/** The "done, unread" mark: unseen, not working, and settled (no flashes between turns). */
function isUnread(s) {
    return hasUnseen(s) && !isWorking(s) && Date.now() - (s.changedAt ?? 0) >= UNREAD_SETTLE;
}

/** A message arrived or work started/stopped: look again once it has settled. */
function sessionChanged(s) {
    s.changedAt = Date.now();
    clearTimeout(s.settleTimer);
    s.settleTimer = setTimeout(() => renderList(), UNREAD_SETTLE + 50);
}

/** The person is looking at this session right now. */
function viewing(s) {
    return s === state.current && document.visibilityState === 'visible' && !document.body.classList.contains('in-settings')
        && (!desktop.active || document.hasFocus()); // the Mac app's window can be visible behind other apps
}

function markRead(s) {
    if (!s || !viewing(s)) return;
    const thread = state.threads.get(s.id);
    s.seq = Math.max(s.seq ?? 0, thread?.afterSeq ?? 0);
    if (state.seen[s.id] === s.seq) return;
    state.seen[s.id] = s.seq;
    saveSeen();
    renderList();
}

function row(s, sub) {
    const r = el('button', 'row');
    r.dataset.id = s.id;
    if (isWorking(s)) r.classList.add('busy');
    if (waitingSets(s).length) r.classList.add('asking');
    if (isUnread(s)) r.classList.add('unread');
    r.title = rowStatus(s);
    if (s === state.current) { r.classList.add('selected'); r.setAttribute('aria-current', 'true'); }
    const title = el('span', 'title');
    // All three icons are there; CSS shows the one for the row's state, so
    // the busy class can flip on a heartbeat without rebuilding the row.
    const status = el('span', 'status');
    status.innerHTML = iconSvg('idle', 14) + iconSvg('working', 14) + iconSvg('waiting', 14) + iconSvg('unread', 14);
    status.firstElementChild.classList.add('st-idle');
    status.children[1].classList.add('st-working');
    status.children[2].classList.add('st-waiting');
    status.children[3].classList.add('st-unread');
    title.append(status, el('span', 'name', sessionTitle(s)));
    if (waitingSets(s).length) title.append(el('em', 'asking', waitingLabel(s)));
    r.append(title);
    const parts = [].concat(sub ?? []).filter(Boolean);
    if (parts.length) {
        const line = el('span', 'sub');
        line.append(...parts.map((t) => el('span', null, t)));
        r.append(line);
    }
    r.onclick = () => openSession(s);
    return r;
}

function renderList() {
    const list = $('list');
    const groups = groupLive([...state.sessions.values()].filter((s) => s.meta.isSideChat !== true && isOnline(s)));
    const { badge } = desktop.update(groups.flatMap((m) => m.sessions), {
        isUnread, isAsking: (s) => waitingSets(s).length > 0, title: sessionTitle, focused: document.hasFocus(),
    });
    if (badge !== state.badge) { state.badge = badge; applyBrand(); }
    const archived = archivedSessions();
    const archivedRows = state.archivedOpen ? archived.slice(0, state.archivedShown) : [];

    // Rebuild only when what the list shows changed; heartbeats alone do not.
    const signature = JSON.stringify([[...state.collapsed], groups.map((m) =>
        [m.key, m.name, m.sessions.map((s) => [s.id, sessionTitle(s), kindOf(s), JSON.stringify(checkout(s)), s.meta.task?.folderName, waitingSets(s).length, isUnread(s), inBackground(s)])]),
        archived.length, state.archivedOpen, archived.length > archivedRows.length,
        archivedRows.map((s) => [s.id, sessionTitle(s), s.meta.path, s.meta.host, archivedAt(s)])]);
    if (signature === state.listSignature) return;
    state.listSignature = signature;

    const keepScroll = list.scrollTop;
    list.replaceChildren();
    if (groups.length === 0) list.append(el('p', 'empty-list', '没有在线的会话。在电脑上运行 happy 开始一个。'));
    for (const m of groups) {
        const collapsed = state.collapsed.has(m.key);
        const section = el('section', 'machine' + (collapsed ? ' collapsed' : ''));
        section.append(groupHead(m.name, m.count, collapsed, () => toggleCollapsed(m.key), 'computer', m.sessions));
        const rows = el('div', 'rows');
        if (m.bots.length) rows.append(kindBlock('Bot', 'agent', m.bots.map((s) => row(s))));
        if (m.tasks.length) rows.append(kindBlock('任务', 'todo', m.tasks.map((s) => row(s, taskPath(s)))));
        if (m.projects.length) rows.append(kindBlock(null, null, m.projects.map((p) => {
            const key = `${m.key}\u0000${p.id}`;
            const worktrees = p.worktrees.map((w) => treeNode(`${key}\u0000${w.id}`, 'worktree', 'branch', w.name, w.id, w.sessions,
                w.sessions.map((s) => row(s))));
            return treeNode(key, 'project', 'folder', p.name, p.title, p.sessions, [...p.own.map((s) => row(s)), ...worktrees]);
        })));
        section.append(rows);
        list.append(section);
    }
    if (archived.length) list.append(archivedSection(archived, archivedRows));
    list.scrollTop = keepScroll;
}

/** Fold or unfold a computer, project or worktree; remembered in this browser. */
function toggleCollapsed(key) {
    if (state.collapsed.has(key)) state.collapsed.delete(key); else state.collapsed.add(key);
    localStorage.setItem('happy.collapsed', JSON.stringify([...state.collapsed]));
    renderList();
}

/** Happy Desktop's place for a task: its folder under ~/Tasks. */
const taskPath = (s) => (s.meta.task.folderName ? `~/Tasks/${s.meta.task.folderName}` : '~/Tasks');

/** One kind of session inside a computer: Bot / 任务 under a small label; the project tree goes without one. */
function kindBlock(label, icon, children) {
    const block = el('div', 'kind');
    if (label) {
        const head = el('div', 'kind-head');
        head.insertAdjacentHTML('beforeend', iconSvg(icon, 13));
        head.append(el('span', null, label));
        block.append(head);
    }
    block.append(...children);
    return block;
}

/**
 * A foldable project or worktree in the chat tree. Open by default; folded,
 * its head carries a dot when a chat inside waits for an answer or is unread.
 */
function treeNode(key, kind, icon, name, title, sessions, children) {
    const collapsed = state.collapsed.has(key);
    const node = el('div', `tree ${kind}` + (collapsed ? ' collapsed' : ''));
    const head = el('button', 'tree-head');
    head.setAttribute('aria-expanded', String(!collapsed));
    if (title) head.title = title;
    if (sessions.some((s) => waitingSets(s).length)) head.classList.add('asking');
    else if (sessions.some(isUnread)) head.classList.add('unread');
    head.insertAdjacentHTML('beforeend', iconSvg(icon, 14));
    head.append(el('span', 'name', name), el('span', 'count', String(sessions.length)), el('span', 'mark'), el('span', 'chev'));
    head.onclick = () => toggleCollapsed(key);
    const rows = el('div', 'rows');
    rows.append(...children);
    node.append(head, rows);
    return node;
}

/** The 已归档 group under the computers: newest first, a page at a time. */
function archivedSection(archived, shown) {
    const collapsed = !state.archivedOpen;
    const section = el('section', 'machine archived' + (collapsed ? ' collapsed' : ''));
    section.append(groupHead('已归档', archived.length, collapsed, () => {
        state.archivedOpen = !state.archivedOpen;
        state.archivedShown = ARCHIVED_PAGE;
        if (state.archivedOpen) localStorage.setItem('happy.archivedOpen', '1'); else localStorage.removeItem('happy.archivedOpen');
        renderList();
    }, 'archive'));
    const rows = el('div', 'rows');
    for (const s of shown) {
        const { project, worktree } = place(s);
        const kind = kindOf(s);
        const where = kind === 'bot' ? 'Bot' : kind === 'task' ? taskPath(s) : worktree ? `${project} / ${worktree}` : project;
        rows.append(row(s, [s.meta.host, where, shortDate(archivedAt(s))]));
    }
    if (archived.length > shown.length) {
        const more = el('button', 'more', `再显示 ${Math.min(ARCHIVED_PAGE, archived.length - shown.length)} 个`);
        more.onclick = () => { state.archivedShown += ARCHIVED_PAGE; renderList(); };
        rows.append(more);
    }
    section.append(rows);
    return section;
}

/** Move the highlight without touching the rest of the list. */
function markSelected() {
    for (const r of $('list').querySelectorAll('.row')) {
        const on = r.dataset.id === state.current?.id;
        r.classList.toggle('selected', on);
        if (on) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
    }
}

function renderHead() {
    const s = state.current;
    $('archive').hidden = !s || isArchived(s);
    renderArchiveButton();
    // Archived, or its CLI is gone: nothing would pick a message up, so offer to bring it back instead.
    $('composer').hidden = !s || isDisconnected(s);
    $('readonly').hidden = !s || !isDisconnected(s);
    renderResume();
    if (!s) {
        $('chat-title').textContent = '';
        $('chat-sub').replaceChildren();
        return;
    }
    $('chat-title').textContent = sessionTitle(s);
    const { shortPath } = place(s);
    const status = isArchived(s) ? '已归档' : s.active ? '在线' : '离线';
    $('chat-sub').replaceChildren(...[s.meta.host, shortPath, status].filter(Boolean).map((t) => el('span', null, t)));
}

// ---------- Resume ----------

const isDisconnected = (s) => isArchived(s) || !s.active;
const MACHINES_FRESH = 15000;

/** The account's computers, cached briefly: whether one is online decides if a session can come back. */
function refreshMachines(force = false) {
    if (!force && state.machines && Date.now() - state.machinesAt < MACHINES_FRESH) return Promise.resolve(state.machines);
    state.machinesLoading ??= loadMachines()
        .then((list) => { state.machines = list; state.machinesAt = Date.now(); return list; })
        .finally(() => { state.machinesLoading = null; });
    return state.machinesLoading;
}

const machineOf = (s) => state.machines?.find((m) => m.id === s.meta.machineId) ?? null;

/** The bar in place of the composer: 已归档 / 离线, and 恢复会话 when it can be offered. */
function renderResume() {
    const s = state.current;
    if (!s || !isDisconnected(s)) return;
    $('readonly-text').textContent = isArchived(s) ? '已归档' : '离线';
    const a = resumeAvailability(s, machineOf(s));
    const known = !!state.machines;
    const button = $('resume');
    button.hidden = !a.show;
    button.disabled = !!s.resuming || !a.ok || !known;
    setButton(button, 'resume', s.resuming ? '正在恢复…' : '恢复会话', !!s.resuming);
    $('resume-why').textContent = a.show && known && !a.ok ? a.reason : '';
    if (!known || Date.now() - state.machinesAt >= MACHINES_FRESH) {
        refreshMachines().then(() => { if (state.current === s) renderResume(); }).catch((e) => console.error(e));
    }
}

/** Bring an archived or offline session back on its computer, in the same session (history kept). */
async function resumeSession(s) {
    if (!s || s.resuming || !isDisconnected(s)) return;
    s.resuming = true;
    renderResume();
    try {
        const m = (await refreshMachines(true)).find((x) => x.id === s.meta.machineId) ?? null;
        const a = resumeAvailability(s, m);
        if (!a.ok) throw new Error(a.reason || '现在无法恢复');
        const params = { sessionId: s.id, fallback: resumeFallback(s, b64(s.dataKey)), fallbackReason: 'ok' };
        try {
            const mode = chosenModeMeta(s);
            if (typeof mode.model === 'string') params.model = mode.model;
            if (typeof mode.permissionMode === 'string') params.permissionMode = mode.permissionMode;
        } catch { /* the daemon falls back to the session's own */ }
        const r = await machineRpc(m, 'resume-happy-session', params);
        if (r?.type === 'error') throw new Error(r.errorMessage || '恢复失败');
        if (r?.type === 'requestToApproveDirectoryCreation') throw new Error('会话所在的目录已经不在了');
        if (!(await waitUntilBack(s))) throw new Error('电脑已经在恢复，但会话还没有连上，稍后再看看');
        notice('');
    } catch (e) {
        notice(`恢复失败：${e.message}`);
    } finally {
        s.resuming = false;
        renderList();
        if (s === state.current) renderHead();
    }
}

/** Waits for the reattached CLI to report in (it marks the session running again). */
async function waitUntilBack(s) {
    for (let i = 0; i < 30; i++) {
        if (s.active && !isArchived(s)) return true;
        await new Promise((r) => setTimeout(r, 1000));
        await syncSessions().catch((e) => console.error(e));
    }
    return s.active && !isArchived(s);
}

// ---------- Messages ----------

const PAGE = 100;
const LATEST = 2147483647; // seq is a Postgres int; before_seq=LATEST means "newest first"

async function openSession(s) {
    const previous = state.current;
    if (previous && previous !== s) {
        const old = state.threads.get(previous.id);
        if (old) old.scrollTop = $('scroll').scrollTop;
    }
    if (previous && previous !== s) {
        const text = $('input').value;
        if (text) state.drafts.set(previous.id, text); else state.drafts.delete(previous.id);
    }
    state.current = s;
    document.body.classList.remove('in-settings');
    document.body.classList.add('in-chat');
    markSelected();
    if (previous !== s) {
        $('input').value = state.drafts.get(s.id) ?? '';
        autosize();
        renderSlash();
        renderActions();
    }
    renderHead();
    renderModelPicker();
    renderAsk();
    renderTray();
    hideSlash();
    clearInterval(state.messageTimer);

    let thread = state.threads.get(s.id);
    if (!thread) {
        thread = {
            el: el('div', 'thread'),
            session: s,
            turns: new Map(),   // turn id -> block (see createTurn)
            newest: null,       // the latest turn: the only one that can still be running
            afterSeq: 0,        // newest seq received: forward sync starts here
            oldestSeq: LATEST,  // oldest seq loaded: scrolling up pages back from here
            hasOlder: true,
            loadingOlder: false,
            lastSeq: 0,         // newest seq rendered: later messages simply append
            seen: new Set(),
            placeholder: null,
            scrollTop: null,
        };
        state.threads.set(s.id, thread);
        // Only the newest page is fetched before showing; older ones load on
        // scroll. A slow load still gets a placeholder; a fast one never blinks.
        const slow = setTimeout(() => {
            if (state.current === s) $('messages').replaceChildren(waitingNode('placeholder', '正在载入…'));
        }, 300);
        try {
            await loadOlder(s, thread);
        } catch (e) {
            console.error(e);
        }
        clearTimeout(slow);
        if (state.current !== s) return;
        if (thread.el.childElementCount === 0) {
            thread.placeholder = el('p', 'placeholder', '这个会话还没有消息。');
            thread.el.append(thread.placeholder);
        }
    }
    showThread(s, thread);
    markRead(s);
    pollMessages(s); // whatever arrived after the newest page, or while cached
    // Socket pushes new messages; polling only covers a dropped connection.
    state.messageTimer = setInterval(() => { if (!socket?.connected) pollMessages(state.current); }, 3000);
}

function showThread(s, thread) {
    $('messages').replaceChildren(thread.el);
    const box = $('scroll');
    box.scrollTop = thread.scrollTop ?? box.scrollHeight;
    renderThinking();
    fillViewport(s, thread);
}

/** A page of mostly hidden records can leave nothing to scroll; keep paging back until there is. */
async function fillViewport(s, thread) {
    const box = $('scroll');
    for (let i = 0; i < 5 && thread.hasOlder && state.current === s && box.scrollHeight <= box.clientHeight + 300; i++) {
        await loadOlder(s, thread).catch((e) => console.error(e));
    }
}

/** Decrypt a page in parallel; views come back in the page's order. */
function decodePage(s, messages) {
    return Promise.all(messages.map(async (m) => ({
        m,
        view: decoded(m.content?.t === 'encrypted' ? await decryptJSON(s.dataKey, m.content.c) : null, m),
    })));
}

/** A record as shown, with when it was sent and the context usage it reports. */
function decoded(raw, m) {
    const view = withSentAt(toView(raw), m);
    const context = view && contextUsage(raw);
    return context ? { ...view, context } : view;
}

/** The server's record time rides along: when a person's message was sent. */
function withSentAt(view, m) {
    return view && m.createdAt ? { ...view, at: m.createdAt } : view;
}

/** One page further back in history, prepended without moving what is on screen. */
async function loadOlder(s, thread) {
    if (!thread.hasOlder || thread.loadingOlder) return;
    thread.loadingOlder = true;
    try {
        const page = await api('GET', `/v3/sessions/${encodeURIComponent(s.id)}/messages?before_seq=${thread.oldestSeq}&limit=${PAGE}`);
        const rows = page.messages.slice().reverse(); // DESC -> ASC
        thread.hasOlder = page.hasMore;
        if (rows.length === 0) return;
        thread.oldestSeq = Math.min(thread.oldestSeq, rows[0].seq);
        thread.afterSeq = Math.max(thread.afterSeq, rows[rows.length - 1].seq);
        const decoded = await decodePage(s, rows.filter((r) => !thread.seen.has(r.id)));
        const box = $('scroll');
        const shown = thread.el.isConnected;
        const before = box.scrollHeight; // older parts of an on-screen turn grow it too
        const fragment = document.createDocumentFragment();
        for (const { m, view } of decoded) {
            thread.seen.add(m.id);
            trackBackground(thread, view, m.seq);
            trackContext(thread, view, m.seq);
            const node = placeView(thread, view, m.seq);
            thread.lastSeq = Math.max(thread.lastSeq, m.seq);
            if (node) fragment.append(node);
        }
        if (fragment.childElementCount) {
            thread.placeholder?.remove();
            thread.placeholder = null;
            thread.el.prepend(fragment);
        }
        if (shown) box.scrollTop += box.scrollHeight - before;
    } finally {
        thread.loadingOlder = false;
    }
}

async function pollMessages(s = state.current) {
    const thread = s && state.threads.get(s.id);
    if (!thread) return;
    try {
        let more = true;
        while (more) {
            const page = await api('GET', `/v3/sessions/${encodeURIComponent(s.id)}/messages?after_seq=${thread.afterSeq}&limit=200`);
            for (const m of page.messages) thread.afterSeq = Math.max(thread.afterSeq, m.seq);
            const fresh = page.messages.filter((m) => !thread.seen.has(m.id));
            fresh.forEach((m) => thread.seen.add(m.id));
            for (const { m, view } of await decodePage(s, fresh)) renderMessage(thread, view, m.seq);
            more = page.hasMore;
        }
    } catch (e) {
        console.error(e);
    }
}

/** One pushed message. Renders it once, in seq order. */
async function acceptMessage(s, m) {
    const thread = state.threads.get(s.id);
    if (!thread) return; // never opened: it loads when it is
    thread.afterSeq = Math.max(thread.afterSeq, m.seq);
    if (thread.seen.has(m.id)) return;
    thread.seen.add(m.id);
    const raw = m.content?.t === 'encrypted' ? await decryptJSON(s.dataKey, m.content.c) : null;
    renderMessage(thread, decoded(raw, m), m.seq);
}

const EVENT_TEXT = {
    'Context was reset': '上下文已清空',
    'Compaction started': '正在压缩对话历史',
    'Compaction completed': '对话历史已压缩',
    'Aborted by user': '已中止',
    'Process exited unexpectedly': '进程意外退出',
};

/** Plaintext record -> { kind: 'user'|'agent'|'tool'|'meta'|'ack', text } or null to hide. */
function toView(raw) {
    if (!raw) return { kind: 'meta', text: '这条消息无法解密。' };
    const content = raw.content ?? {};
    if (raw.role === 'user' && content.type === 'text') return userView(content.text);

    if (raw.role === 'session') {
        const env = content.type === 'session' ? content.data : content;
        const ev = env?.ev ?? {};
        const at = { turn: env?.role === 'agent' ? env.turn ?? null : null, time: env?.time ?? 0 };
        switch (ev.t) {
            case 'text':
                if (env.role === 'user') return userView(ev.text);
                return { kind: ev.thinking ? 'thinking' : 'agent', text: ev.text, ...at };
            case 'service': return { kind: 'meta', text: ev.text, ...at };
            case 'tool-call-start': return { kind: 'tool', call: ev.call, name: ev.name, title: ev.title, args: ev.args, text: ev.title || ev.name, ...at };
            case 'tool-call-end': return at.turn ? { kind: 'tool-end', call: ev.call, ...at } : null;
            case 'turn-start': return at.turn ? { kind: 'turn-start', ...at } : null;
            case 'turn-end': return at.turn ? { kind: 'turn-end', status: ev.status, ...at } : null;
            case 'file':
                if (ev.image || String(ev.mimeType ?? '').startsWith('image/')) {
                    return { kind: 'image', mine: env.role === 'user', ref: ev.ref, name: ev.name, mimeType: ev.mimeType, image: ev.image };
                }
                return { kind: 'tool', text: `附件 ${ev.name}` };
            default: return null; // turn-start/end, tool-call-end, start/stop, receipts
        }
    }

    // CLI status events: { role: agent, content: { type: event, data: { type: message, message } } }.
    // /clear only ever answers with "Context was reset", so this is its sole sign of life.
    if (raw.role === 'agent' && content.type === 'event') {
        const ev = content.data ?? {};
        if (ev.type !== 'message' || !ev.message || ev.message === 'Turn started') return { kind: 'ack' };
        return { kind: 'meta', text: EVENT_TEXT[ev.message] ?? ev.message, ack: true };
    }

    // Legacy Claude output: { role: agent, content: { type: output, data: { type: assistant, message } } }
    if (raw.role === 'agent' && content.type === 'output' && content.data?.type === 'assistant') {
        const blocks = content.data.message?.content ?? [];
        const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        if (text) return { kind: 'agent', text };
        const tool = blocks.find((b) => b.type === 'tool_use');
        return tool ? { kind: 'tool', text: tool.name } : null;
    }
    return null;
}

const renderable = (view) => !!view && (view.kind === 'image' ? !!view.ref : !!view.text?.trim());

/**
 * A person's message, with the SDK's slash-command records read (see localCommand.js).
 * `stops`: the background tasks its <task-notification>s report as finished.
 */
function userView(text) {
    const view = parseUserText(text);
    const stops = backgroundStops(text);
    if (!stops.length) return view;
    return view ? { ...view, stops } : { kind: 'stops', stops };
}

function parseUserText(text) {
    const c = parseLocalCommand(text);
    switch (c.kind) {
        case 'hidden':
        case 'caveat': return null;
        case 'output': return c.text ? { kind: 'output', text: c.text } : null;
        case 'command': return { kind: 'user', text: commandText(c), command: c };
        default: return { kind: 'user', text: c.text };
    }
}

/** Keeps `thread.background` in step with what the agent left running (see background.js). */
function trackBackground(thread, view, seq) {
    (thread.background ??= backgroundTracker()).see(view, seq);
}

/** The newest context usage a reply reported (see context.js); older pages never replace it. */
function trackContext(thread, view, seq) {
    if (!view?.context || seq <= (thread.context?.seq ?? -Infinity)) return;
    thread.context = { ...view.context, seq };
    if (thread.session === state.current) renderContext();
}

function messageNode(view, s) {
    if (view.kind === 'output') return el('pre', 'msg output', view.text);
    if (view.kind === 'image') {
        const node = el('figure', `msg image${view.mine ? ' mine' : ''}`);
        if (view.mine && view.at) node.dataset.time = messageTime(view.at);
        const link = el('a');
        link.target = '_blank';
        link.rel = 'noopener';
        const img = el('img');
        img.alt = view.name || '图片';
        // Reserve the space up front so the chat does not jump when it loads.
        if (view.image?.width && view.image?.height) {
            img.style.aspectRatio = `${view.image.width} / ${view.image.height}`;
            img.style.width = `min(320px, ${view.image.width}px)`; // never upscale a small picture
        }
        link.append(img);
        node.append(link);
        imageUrl(api, s, view.ref, view.mimeType).then((url) => {
            if (url) { img.src = url; link.href = url; } else { node.classList.add('failed'); node.title = '图片加载失败'; }
        });
        return node;
    }
    if (view.kind === 'agent' || view.kind === 'thinking') {
        const node = el('div', `msg ${view.kind} md markdown-body`);
        node.innerHTML = renderMarkdown(view.text);
        addCopyButtons(node, view.kind === 'agent' ? view.text : null);
        return node;
    }
    if (view.kind === 'tool') {
        const node = el('div', 'msg tool');
        node.innerHTML = renderInlineMarkdown(view.text);
        return node;
    }
    const node = el('div', `msg ${view.kind}`, view.text);
    if (view.kind === 'user' && view.at) node.dataset.time = messageTime(view.at);
    return node;
}

function renderMessage(thread, view, seq) {
    const shown = thread.el.isConnected;
    const box = $('scroll');
    const stick = shown && box.scrollTop + box.clientHeight >= box.scrollHeight - 80;
    if (view?.kind === 'ack' || view?.ack) thread.awaiting = null; // the agent answered outside a turn
    trackBackground(thread, view, seq);
    trackContext(thread, view, seq);
    const node = placeView(thread, view, seq);
    if (node) {
        thread.placeholder?.remove();
        thread.placeholder = null;
        const thinking = state.thinkingNode?.parentElement === thread.el ? state.thinkingNode : null;
        if (seq > thread.lastSeq) {
            thread.el.insertBefore(node, thinking); // the usual case: newest goes last
        } else {
            // Rare: a push overtook an older message still decrypting.
            let later = null;
            for (const n of thread.el.children) {
                if (Number(n.dataset.seq) > seq) { later = n; break; }
            }
            thread.el.insertBefore(node, later ?? thinking);
        }
    }
    thread.lastSeq = Math.max(thread.lastSeq, seq);
    if (thread.session === state.current) { renderThinking(); markRead(thread.session); }
    if (stick) box.scrollTop = box.scrollHeight;
    if (!shown) thread.scrollTop = null; // reopen at the newest message
}

// ---------- Turns: a turn's steps fold under "已工作 7分2秒" ----------

const TURN_KINDS = new Set(['agent', 'thinking', 'tool', 'tool-end', 'turn-start', 'turn-end', 'meta']);

/**
 * Put one decoded message into a thread. Agent messages of a turn go into
 * that turn's block; everything else is a node of its own. Returns the
 * top-level node the caller must insert (a new message or a new turn block),
 * or null when nothing new appears at the top level.
 */
function placeView(thread, view, seq) {
    if (view?.turn && TURN_KINDS.has(view.kind)) {
        let block = thread.turns.get(view.turn);
        const created = !block;
        if (created) block = createTurn(thread, view.turn, seq);
        addToTurn(thread, block, view, seq);
        return created ? block.el : null;
    }
    if (view?.command) {
        // The SDK records a run command again after its output; the person's
        // own "/name" is already on screen, so its record is not shown twice.
        const key = commandText(view.command);
        thread.commandEchoes ??= [];
        if (view.command.raw) {
            thread.commandEchoes.push(key);
            if (thread.commandEchoes.length > 10) thread.commandEchoes.shift();
        } else {
            const i = thread.commandEchoes.indexOf(key);
            if (i >= 0) { thread.commandEchoes.splice(i, 1); return null; }
        }
    }
    if (!renderable(view)) return null;
    if (view.kind === 'user') (thread.prompts ??= new Map()).set(seq, view.text); // for ↑ in the composer
    const node = messageNode(view, thread.session);
    node.dataset.seq = String(seq);
    return node;
}

function insertBySeq(container, node, seq) {
    const last = container.lastElementChild;
    if (!last || Number(last.dataset.seq) < seq) { container.append(node); return; }
    for (const n of container.children) {
        if (Number(n.dataset.seq) > seq) { container.insertBefore(node, n); return; }
    }
    container.append(node);
}

function createTurn(thread, turn, seq) {
    const block = {
        turn, seq, maxSeq: seq,
        start: null, end: null, first: null, last: 0, lastAt: 0, // times (ms); lastAt: the server's, a fallback
        ended: false, collapsed: false, userToggled: false,
        tools: new Map(), endedCalls: new Set(),
    };
    block.el = el('section', 'turn');
    block.el.dataset.seq = String(seq);
    block.head = el('button', 'turn-head');
    block.head.type = 'button';
    block.label = el('span', 'turn-label');
    block.head.append(el('span', 'spin'), block.label, el('span', 'chev'));
    block.head.onclick = () => { block.userToggled = true; setCollapsed(block, !block.collapsed); };
    block.body = el('div', 'turn-body');
    block.final = el('div', 'turn-final');
    block.el.append(block.head, block.body, block.final);
    thread.turns.set(turn, block);
    return block;
}

function addToTurn(thread, block, view, seq) {
    block.seq = Math.min(block.seq, seq);
    block.maxSeq = Math.max(block.maxSeq, seq);
    block.el.dataset.seq = String(block.seq);
    const previous = thread.newest;
    if (!thread.newest || block.maxSeq >= thread.newest.maxSeq) thread.newest = block;
    if (view.at) block.lastAt = Math.max(block.lastAt, view.at);
    if (view.time) {
        block.first = Math.min(block.first ?? view.time, view.time);
        block.last = Math.max(block.last, view.time);
    }
    thread.awaiting = null; // the agent has picked the message up
    switch (view.kind) {
        case 'turn-start': block.start = view.time; break;
        case 'turn-end': {
            block.ended = true;
            block.end = view.time;
            // The "thinking" flag rides on keepalives and lags the turn's end;
            // stop showing it now, and ignore reports older than this moment.
            const s = thread.session;
            if (s && block === thread.newest) {
                // Measured on this browser's clock: the CLI's clock may be off,
                // and the server clamps keepalive times to its own.
                s.thinkingMutedUntil = Date.now() + THINKING_MUTE;
                if (s.thinking) sessionChanged(s);
                s.thinking = false;
                document.querySelector(`#list .row[data-id="${CSS.escape(s.id)}"]`)?.classList.toggle('busy', isWorking(s));
            }
            break;
        }
        case 'tool-end':
            block.endedCalls.add(view.call);
            block.tools.get(view.call)?.classList.add('done');
            break;
        case 'tool': {
            const row = toolRow(view, thread.session);
            row.dataset.seq = String(seq);
            row.dataset.time = String(view.time || Date.now());
            if (block.endedCalls.has(view.call)) row.classList.add('done');
            block.tools.set(view.call, row);
            insertBySeq(block.body, row, seq);
            break;
        }
        default: {
            if (!renderable(view)) break;
            const node = messageNode(view, thread.session);
            node.dataset.seq = String(seq);
            insertBySeq(block.body, node, seq);
        }
    }
    // A newer turn means the previous one is over, even if its end never came.
    if (previous && previous !== thread.newest && previous.el.classList.contains('running')) refreshTurn(thread, previous);
    refreshTurn(thread, block);
}

function isRunning(thread, block) {
    return !block.ended && block === thread.newest && isOnline(thread.session);
}

function setCollapsed(block, collapsed) {
    block.collapsed = collapsed;
    block.el.classList.toggle('collapsed', collapsed);
    block.head.setAttribute('aria-expanded', String(!collapsed));
}

function refreshTurn(thread, block) {
    // The last answer of a finished turn stays outside the fold.
    const kept = block.final.firstElementChild;
    if (kept) insertBySeq(block.body, kept, Number(kept.dataset.seq));
    if (block.ended || !isRunning(thread, block)) {
        const last = block.body.lastElementChild;
        if (last?.classList.contains('agent')) block.final.append(last);
    }
    const running = isRunning(thread, block);
    block.el.classList.toggle('running', running);
    block.head.hidden = !running && block.body.childElementCount === 0; // a plain answer needs no fold
    if (!block.userToggled) setCollapsed(block, !running);
    tickTurn(block, running);
    // No fold to carry the finish time: the answer shows it, by its copy button.
    const answer = block.final.firstElementChild;
    let stamp = answer?.querySelector(':scope > .msg-time');
    const when = block.head.hidden ? finishedAt(block) : '';
    if (when && answer) {
        stamp ??= answer.appendChild(el('span', 'msg-time'));
        stamp.textContent = when;
    } else stamp?.remove();
}

/** When a finished turn ended, as the chat shows it ('' if unknown). */
function finishedAt(block) {
    return messageTime(block.end || block.last || block.lastAt);
}

/** Header text and the clocks of tools still running. */
function tickTurn(block, running = block.el.classList.contains('running')) {
    const now = Date.now();
    const start = block.start ?? block.first ?? now;
    block.label.textContent = running
        ? `正在工作 ${formatDuration(now - start)}`
        : `已工作 ${formatDuration((block.end ?? block.last ?? start) - start)}${finishedAt(block) ? ` · ${finishedAt(block)}` : ''}`;
    if (!running) return;
    for (const row of block.tools.values()) {
        if (!row.classList.contains('done')) row.querySelector('.time').textContent = formatDuration(now - Number(row.dataset.time));
    }
}

function toolRow(view, s) {
    const home = s?.meta?.homeDir;
    const short = (p) => (home && p.startsWith(home) ? '~' + p.slice(home.length) : p);
    const d = describeTool(view, short);
    const row = el('div', 'tool-row');
    const line = el('button', 'tool-line');
    line.type = 'button';
    line.innerHTML = iconSvg(d.icon);
    line.append(el('span', 'spin')); // shown instead of the icon while the tool runs
    const text = el('span', 'tool-text');
    if (d.markdown) text.innerHTML = renderInlineMarkdown(d.text); else text.textContent = d.text;
    line.append(text, el('span', 'time'));
    line.title = d.text;
    const detail = el('pre', 'tool-detail', d.detail || d.text);
    detail.hidden = true;
    line.onclick = () => {
        detail.hidden = !detail.hidden;
        row.classList.toggle('open', !detail.hidden);
    };
    row.append(line, detail);
    return row;
}

const AWAIT_LIMIT = 3 * 60 * 1000;

/** After sending, until the agent shows a sign of life. */
function awaiting(thread) {
    return !!thread?.awaiting && Date.now() - thread.awaiting < AWAIT_LIMIT;
}

/** The "等待回复 / 正在思考" line, unless a running turn header already says it; and the stop button. */
function renderThinking() {
    const s = state.current;
    const thread = s && state.threads.get(s.id);
    const turnShowsIt = thread?.newest && isRunning(thread, thread.newest);
    const waiting = awaiting(thread);
    const on = !!(thread && (s.thinking || waiting) && !isArchived(s) && !turnShowsIt);
    renderStop(s, thread, turnShowsIt || on);
    // Idle, but a subagent or command it started in the background still runs.
    const tasks = thread && !on && !turnShowsIt && s.active && !isArchived(s) ? thread.background?.tasks() ?? [] : [];
    const node = state.thinkingNode;
    if (!on && !tasks.length) { node?.remove(); return; }
    const fresh = !node || node.parentElement !== thread.el;
    const next = node ?? el('div', 'msg thinking-now');
    next.id = 'thinking';
    if (tasks.length) fillBackground(next, thread, tasks);
    else fillWaiting(next, s.thinking ? '正在思考' : '等待回复');
    state.thinkingNode = next;
    if (!fresh) return;
    thread.el.append(next);
    const box = $('scroll');
    box.scrollTop = box.scrollHeight;
}

function fillWaiting(node, text) {
    if (node.classList.contains('background') || !node.querySelector('.label')) {
        node.className = 'msg thinking-now';
        node.replaceChildren(el('span', 'spin'), el('span', 'label'));
    }
    node.querySelector('.label').textContent = text;
}

/** "后台运行中：A 等 3 个", opening to every task; a task jumps to the call that started it. */
function fillBackground(node, thread, tasks) {
    const open = !!thread.backgroundOpen;
    node.className = `msg thinking-now background${open ? ' open' : ''}`;
    const head = el('button', 'bg-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(open));
    head.append(el('span', 'spin'), el('span', 'label', backgroundText(tasks.map((t) => t.label))), el('span', 'chev'));
    head.onclick = () => {
        thread.backgroundOpen = !thread.backgroundOpen;
        renderThinking();
        if (thread.backgroundOpen) node.scrollIntoView({ block: 'nearest' });
    };
    const list = el('ul', 'bg-list');
    list.hidden = !open;
    for (const task of tasks.slice().reverse()) { // newest first, as the line names it
        const item = el('li');
        const go = el('button', 'bg-task');
        go.type = 'button';
        go.append(el('span', 'bg-label', task.label), el('span', 'bg-time'));
        if (task.since) go.querySelector('.bg-time').dataset.since = String(task.since);
        const row = launchRow(thread, task.id);
        if (row) {
            go.title = '跳到启动它的地方';
            go.onclick = () => revealRow(row);
        } else {
            go.disabled = true;
            go.title = '启动它的消息还没载入';
        }
        item.append(go);
        list.append(item);
    }
    node.replaceChildren(head, list);
    tickBackground(node);
}

/** The tool row of the call that started a background task, if loaded. */
function launchRow(thread, call) {
    for (const block of thread.turns.values()) {
        const row = block.tools.get(call);
        if (row) return { block, row };
    }
    return null;
}

/** Unfold its turn, open its details, and bring it into view for a moment. */
function revealRow({ block, row }) {
    block.userToggled = true;
    setCollapsed(block, false);
    const detail = row.querySelector('.tool-detail');
    if (detail?.hidden) row.querySelector('.tool-line').click();
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.remove('flash');
    void row.offsetWidth; // restart the animation
    row.classList.add('flash');
}

/** "已运行 3分2秒" on each listed task. */
function tickBackground(node = state.thinkingNode) {
    if (!node?.classList.contains('open')) return;
    for (const time of node.querySelectorAll('.bg-time[data-since]')) {
        time.textContent = `已运行 ${formatDuration(Date.now() - Number(time.dataset.since))}`;
    }
}

// ---------- Stop ----------

/** happy-ios SessionActions.abortReason: what Claude is told when the person stops it. */
const ABORT_REASON = "The user doesn't want to proceed with this tool use. "
    + 'The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). '
    + 'STOP what you are doing and wait for the user to tell you how to proceed.';

/** Happy Agent sessions list what they support; the shipped CLIs all take abort. */
function canAbort(meta) {
    if (!isRig(meta)) return true;
    return (meta.capabilities?.rpcMethods ?? []).includes('abort') && meta.capabilities?.abort === true;
}

function renderStop(s, thread, working) {
    state.canStop = !!(s && thread && working && !isArchived(s) && canAbort(s.meta));
    renderActions();
}

/** One button in the corner: stop while the agent works and nothing is typed, else send. */
function renderActions() {
    const s = state.current;
    const stop = $('stop');
    const send = $('send');
    const draft = !!$('input').value.trim() || !!(s && state.pendingImages.get(s.id)?.length);
    const stopping = !!stop.dataset.busy;
    stop.hidden = !(stopping || (state.canStop && !draft && !state.sending));
    send.hidden = !stop.hidden;
    send.classList.toggle('empty', !draft && !state.sending);
}

async function stopCurrent() {
    const s = state.current;
    if (!s) return;
    const button = $('stop');
    button.dataset.busy = '1';
    button.disabled = true;
    setButton(button, 'stop', '正在停止', true);
    button.title = '正在停止';
    try {
        await sessionRpc(s, 'abort', isRig(s.meta) ? {} : { reason: ABORT_REASON });
        const thread = state.threads.get(s.id);
        if (thread) thread.awaiting = null;
        notice('');
    } catch (e) {
        notice(`没有停下来：${e.message}`);
    } finally {
        delete button.dataset.busy;
        button.disabled = false;
        setButton(button, 'stop', '停止');
        button.title = '停止';
        renderThinking();
        renderActions();
    }
}



// ---------- Model ----------

function chosenModelKey(s) {
    return localStorage.getItem(`happy.model.${s.id}`);
}

function chosenEffort(s) {
    return localStorage.getItem(`happy.effort.${s.id}`);
}

/** The model the next message runs on: picked here, else the settings default, else the session's own. */
function effectiveModelKey(s) {
    return chosenModelKey(s) || defaultsFor(s.meta).modelKey || currentModelKey(s.meta);
}

function renderModelPicker() {
    const s = state.current;
    const picker = $('model');
    if (!s) { picker.hidden = true; $('effort').hidden = true; $('permission').hidden = true; return; }
    const options = modelOptions(s.meta);
    const chosen = chosenModelKey(s);
    const current = currentModelKey(s.meta);
    const known = new Set(options.map((o) => o.key));
    picker.replaceChildren();
    const currentName = options.find((o) => o.key === current)?.name ?? current;
    const fallback = defaultsFor(s.meta).modelKey;
    const fallbackName = fallback && options.find((o) => o.key === fallback)?.name;
    const first = el('option', null, fallbackName ? `默认：${fallbackName}` : currentName ? `当前模型：${currentName}` : '当前模型');
    first.value = '';
    picker.append(first);
    for (const o of options) {
        const opt = el('option', null, o.key === current ? `${o.name}（当前）` : o.name);
        opt.value = o.key;
        picker.append(opt);
    }
    picker.value = chosen && known.has(chosen) ? chosen : '';
    picker.hidden = options.length === 0;
    renderEffortPicker();
    renderPermissionPicker();
    renderUsage();
    renderContext();
}

/** "上下文剩 63%": how much of the model's window the conversation still leaves. */
function renderContext() {
    const box = $('context');
    const s = state.current;
    const context = s && !isArchived(s) ? state.threads.get(s.id)?.context : null;
    if (!context) { box.hidden = true; box.textContent = ''; return; }
    const line = contextLine(context);
    box.textContent = line.text;
    box.className = `u-${line.level}`;
    box.title = `${line.title}\n按最近一条回复统计，每条回复后更新`;
    box.hidden = false;
}

/** Plan usage (Claude sessions report it after each turn): "5 小时 42% · 7 天 18% · 截至 14:05". */
function renderUsage() {
    const box = $('usage');
    const s = state.current;
    const usage = s && !isArchived(s) ? usageRows(s.agentState?.usageLimits) : null;
    if (!usage) { box.hidden = true; box.replaceChildren(); return; }
    // The 5h and 7d windows always; any other one only when it is near or over.
    const shown = usage.rows.filter((r) => r.id === 'five_hour' || r.id === 'seven_day' || r.level !== 'ok');
    const rows = shown.length ? shown : usage.rows.slice(0, 2);
    const parts = rows.map((r) => el('span', `u-${r.reset ? 'reset' : r.level}`, rowText(r)));
    const when = capturedText(usage);
    if (when) parts.push(el('span', 'u-when', when));
    box.replaceChildren(...parts);
    box.title = '订阅用量（这台电脑上登录的 Claude 账号）\n' + usageTooltip(usage);
    box.hidden = false;
}

const chosenPermission = (s) => localStorage.getItem(`happy.permission.${s.id}`);

function setChosenPermission(s, mode) {
    if (mode) localStorage.setItem(`happy.permission.${s.id}`, mode); else localStorage.removeItem(`happy.permission.${s.id}`);
}

/** The permission mode messages go out with: picked here, else the agent's default, else none (the CLI keeps its own). */
function effectivePermission(s) {
    const mode = chosenPermission(s) || defaultsFor(s.meta).permission;
    return mode && permissionOptions(s.meta).some((o) => o.key === mode) ? mode : null;
}

function renderPermissionPicker() {
    const s = state.current;
    const picker = $('permission');
    const options = s ? permissionOptions(s.meta) : [];
    const fallback = s ? defaultsFor(s.meta).permission : null;
    const fallbackName = fallback && options.find((o) => o.key === fallback)?.name;
    picker.replaceChildren();
    const first = el('option', null, fallbackName ? `默认：${fallbackName}` : '默认权限');
    first.value = '';
    picker.append(first);
    for (const o of options) {
        const opt = el('option', null, o.name);
        opt.value = o.key;
        opt.title = o.description;
        picker.append(opt);
    }
    const chosen = s && chosenPermission(s);
    picker.value = chosen && options.some((o) => o.key === chosen) ? chosen : '';
    picker.title = (options.find((o) => o.key === (picker.value || fallback))?.description) || '权限模式：不指定时由 Happy CLI 决定';
    picker.hidden = options.length === 0;
}

function renderEffortPicker() {
    const s = state.current;
    const picker = $('effort');
    const levels = s ? effortOptions(s.meta, effectiveModelKey(s)) : [];
    const current = s ? currentEffort(s.meta) : null;
    const fallback = s ? defaultsFor(s.meta, effectiveModelKey(s)).effort : null;
    picker.replaceChildren();
    const first = el('option', null, fallback ? `默认：${effortName(fallback)}` : current ? `当前强度：${effortName(current)}` : '默认强度');
    first.value = '';
    picker.append(first);
    for (const level of levels) {
        const opt = el('option', null, level === current ? `${effortName(level)}（当前）` : effortName(level));
        opt.value = level;
        picker.append(opt);
    }
    const chosen = s && chosenEffort(s);
    picker.value = chosen && levels.includes(chosen) ? chosen : '';
    picker.hidden = levels.length === 0;
}

/** Model and effort fields for the next message: what was picked here, else the settings defaults. */
function chosenModeMeta(s) {
    const key = chosenModelKey(s) || defaultsFor(s.meta).modelKey;
    const meta = modelMeta(key ? modelOptions(s.meta).find((o) => o.key === key) : null);
    const effort = chosenEffort(s) || defaultsFor(s.meta, effectiveModelKey(s)).effort;
    // A level the (newly chosen) model does not take is left out, not sent.
    if (effort && effortOptions(s.meta, effectiveModelKey(s)).includes(effort)) meta.effort = effort;
    // 跟随 Codex 配置 with no level picked: clear Happy's default effort too, so config.toml's applies.
    else if (meta.model === null) meta.effort = null;
    const permission = effectivePermission(s);
    if (permission) meta.permissionMode = permission;
    return meta;
}

async function send() {
    const s = state.current;
    const input = $('input');
    const pending = s ? state.pendingImages.get(s.id) ?? [] : [];
    const text = input.value.trim();
    if (!s || isArchived(s) || (!text && pending.length === 0) || state.sending) return;
    state.sending = true;
    const button = $('send');
    button.disabled = true;
    setButton(button, 'send', pending.length ? '正在上传' : '发送', true);
    button.title = pending.length ? '正在上传' : '正在发送';
    try {
        const images = await Promise.all(pending.map((p) => p.promise));
        const refs = await Promise.all(images.map((image) => uploadImage(api, s, image)));
        refs.forEach((ref, i) => rememberImage(ref, images[i].previewUrl));
        const now = Date.now();
        const messages = [];
        for (let i = 0; i < images.length; i++) {
            messages.push({ content: await encryptJSON(s.dataKey, fileEvent(refs[i], images[i], uuid(), now)), localId: uuid() });
        }
        // The CLI hands images to Claude together with the text after them,
        // and Claude refuses an empty text block, so a picture alone gets a line.
        const body = text || (images.length > 1 ? '请看这些图片。' : '请看这张图片。');
        messages.push({
            content: await encryptJSON(s.dataKey, {
                role: 'user',
                content: { type: 'text', text: body },
                meta: { sentFrom: 'web', ...chosenModeMeta(s) },
            }),
            localId: uuid(),
        });
        await api('POST', `/v3/sessions/${encodeURIComponent(s.id)}/messages`, { messages });
        state.drafts.delete(s.id);
        // Switched chats while uploading: the box now holds the other chat's draft.
        if (state.current === s) {
            input.value = '';
            autosize();
            hideSlash();
        }
        state.pendingImages.delete(s.id);
        renderTray();
        const sentThread = state.threads.get(s.id);
        if (sentThread) { sentThread.awaiting = Date.now(); renderThinking(); }
        if (!socket?.connected) await pollMessages();
    } catch (e) {
        notice(`没有发出去：${e.message}`);
    } finally {
        state.sending = false;
        button.disabled = false;
        setButton(button, 'send', '发送');
        button.title = '发送（回车）';
        renderActions();
    }
}

// ---------- Slash commands ----------

const slash = { word: null, items: [], index: -1 };

/** Show the commands matching the "/word" at the caret, or hide the list. */
/**
 * Where a session's slash commands come from. Claude reports them only once
 * it has run (after the first message), so a fresh session borrows them
 * from the newest session on the same computer that has them.
 */
function commandMeta(s) {
    const has = (m) => (m?.slashCommands?.length ?? 0) + (m?.skills?.length ?? 0) > 0;
    if (has(s.meta)) return s.meta;
    let best = null;
    for (const other of state.sessions.values()) {
        if (other === s || machineKey(other) !== machineKey(s) || (other.meta.flavor || 'claude') !== (s.meta.flavor || 'claude') || !has(other.meta)) continue;
        if (!best || other.activeAt > best.activeAt) best = other;
    }
    return best ? { slashCommands: best.meta.slashCommands, skills: best.meta.skills } : s.meta;
}

function renderSlash() {
    const input = $('input');
    const box = $('slash');
    const s = state.current;
    const word = s && input.selectionStart === input.selectionEnd ? activeSlash(input.value, input.selectionStart) : null;
    const items = word ? searchCommands(word.query, commandMeta(s)) : [];
    const sameList = items.length === slash.items.length && items.every((c, i) => c.name === slash.items[i].name);
    slash.word = word;
    if (!sameList) slash.index = items.length ? 0 : -1;
    slash.items = items;
    box.hidden = items.length === 0;
    input.setAttribute('aria-expanded', String(!box.hidden));
    if (box.hidden) { box.replaceChildren(); return; }
    box.replaceChildren(...items.map((c, i) => {
        const b = el('button', 'slash-item');
        b.type = 'button';
        b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', String(i === slash.index));
        b.append(el('span', 'cmd', '/' + c.name), el('span', 'desc', c.description ?? ''));
        if (c.skill) b.append(el('span', 'kind', 'skill'));
        b.title = c.description ? `/${c.name} — ${c.description}` : `/${c.name}`;
        b.onmousedown = (e) => e.preventDefault(); // keep focus in the input
        b.onclick = () => pickSlash(i);
        return b;
    }));
    box.children[slash.index]?.scrollIntoView({ block: 'nearest' });
}

function hideSlash() {
    slash.word = null;
    slash.items = [];
    slash.index = -1;
    $('slash').hidden = true;
    $('slash').replaceChildren();
}

function pickSlash(i) {
    const c = slash.items[i];
    if (!c || !slash.word) return;
    const input = $('input');
    const next = applyCommand(input.value, slash.word, c.name);
    input.value = next.text;
    input.setSelectionRange(next.caret, next.caret);
    input.focus();
    hideSlash();
    autosize();
}

/** Arrow keys, Tab/Enter and Escape while the list is open. True when handled. */
/**
 * ↑ in an empty composer brings back the last message sent in this chat, ↑
 * again the one before; ↓ goes forward and past the newest empties the box.
 * Only on the first / last line, and stops once the recalled text is edited.
 */
function historyKey(e) {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
    const s = state.current;
    const input = $('input');
    if (!s || input.selectionStart !== input.selectionEnd) return false;
    // Still walking only while the box holds what the last step put there (not edited, sent or switched).
    const browse = state.browse?.sessionId === s.id && state.browse.text === input.value ? state.browse : null;
    const up = e.key === 'ArrowUp';
    if (up ? (input.value !== '' && !browse) || !onFirstLine(input.value, input.selectionStart)
        : !browse || !onLastLine(input.value, input.selectionEnd)) return false;
    const step = stepHistory(promptHistory(state.threads.get(s.id)?.prompts), browse, up ? 'up' : 'down', input.value);
    if (!step) return false;
    state.browse = step.browse && { ...step.browse, sessionId: s.id };
    input.value = step.text;
    input.setSelectionRange(step.text.length, step.text.length);
    autosize();
    hideSlash();
    renderActions();
    return true;
}

function slashKey(e) {
    if ($('slash').hidden || !slash.items.length) return false;
    const n = slash.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        slash.index = (slash.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        const children = $('slash').children;
        for (let i = 0; i < children.length; i++) children[i].setAttribute('aria-selected', String(i === slash.index));
        children[slash.index]?.scrollIntoView({ block: 'nearest' });
        return true;
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        pickSlash(slash.index < 0 ? 0 : slash.index);
        return true;
    }
    if (e.key === 'Escape') { hideSlash(); return true; }
    return false;
}

// ---------- Picking images ----------

function addImages(files) {
    const s = state.current;
    if (!s || isArchived(s)) return;
    const list = state.pendingImages.get(s.id) ?? [];
    for (const file of files) {
        if (!file.type.startsWith('image/')) { notice(`「${file.name}」不是图片`); continue; }
        if (list.length >= 10) { notice('一次最多附带 10 张图片'); break; }
        const entry = { id: uuid(), image: null, promise: prepareImage(file) };
        entry.promise.then((image) => { entry.image = image; renderTray(); })
            .catch((e) => { removeImage(s, entry.id); notice(e.message); });
        list.push(entry);
    }
    state.pendingImages.set(s.id, list);
    renderTray();
}

function removeImage(s, id) {
    const list = (state.pendingImages.get(s.id) ?? []).filter((p) => p.id !== id);
    if (list.length) state.pendingImages.set(s.id, list); else state.pendingImages.delete(s.id);
    if (s === state.current) renderTray();
}

/** Thumbnails of the images waiting to go with the next message. */
function renderTray() {
    const tray = $('tray');
    const s = state.current;
    const list = s ? state.pendingImages.get(s.id) ?? [] : [];
    tray.replaceChildren();
    tray.hidden = list.length === 0;
    renderActions(); // a picked image turns stop back into send
    for (const entry of list) {
        const item = el('div', 'thumb');
        if (entry.image) {
            const img = el('img');
            img.src = entry.image.previewUrl;
            img.alt = entry.image.name;
            item.append(img);
        } else {
            item.classList.add('loading');
        }
        const remove = el('button', 'remove', '×');
        remove.setAttribute('aria-label', '移除这张图片');
        remove.onclick = () => removeImage(s, entry.id);
        item.append(remove);
        tray.append(item);
    }
}

// ---------- Questions from the agent ----------

/** Question sets the agent is waiting on, minus ones answered here a moment ago. */
/** Questions and tool approvals the session waits on, oldest first. */
function waitingSets(s) {
    if (isArchived(s)) return [];
    return [...pendingQuestions(s.agentState), ...pendingApprovals(s.agentState)]
        .filter((set) => !state.askSent.has(`${s.id}:${set.id}`))
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function askDrafts(s, set) {
    const key = `${s.id}:${set.id}`;
    if (!state.askDrafts.has(key)) {
        state.askDrafts.set(key, Object.fromEntries(set.questions.map((q) => [q.id, { options: [], custom: '' }])));
    }
    return state.askDrafts.get(key);
}

function renderAsk() {
    const box = $('ask');
    const s = state.current;
    const sets = s ? waitingSets(s) : [];
    const set = sets[0];
    const signature = set ? `${s.id}:${set.id}:${sets.length}` : 'none';
    if (signature === state.askSignature) return; // keep focus and typing intact
    state.askSignature = signature;
    box.replaceChildren();
    box.hidden = !set;
    if (!set) return;
    if (set.via === 'approval') { box.append(approvalCard(s, set, sets.length - 1)); return; }

    const drafts = askDrafts(s, set);
    const card = el('div', 'ask-card');
    const submit = el('button', 'primary', '提交回答');
    const refresh = () => { submit.disabled = !canSubmit(set, drafts); };

    for (const q of set.questions) {
        const block = el('div', 'ask-q');
        const head = [q.header, q.multiSelect ? '可多选' : ''].filter(Boolean);
        if (head.length) {
            const line = el('div', 'ask-head');
            line.append(...head.map((t) => el('span', null, t)));
            block.append(line);
        }
        block.append(el('p', 'ask-text', q.question));
        if (q.options.length) {
            const list = el('div', 'ask-options');
            list.setAttribute('role', q.multiSelect ? 'group' : 'radiogroup');
            for (const option of q.options) {
                const b = el('button', 'ask-opt');
                b.type = 'button';
                b.setAttribute('aria-pressed', String(drafts[q.id].options.includes(option.label)));
                b.append(el('span', 'label', option.label));
                if (option.description) b.append(el('span', 'desc', option.description));
                b.onclick = () => {
                    drafts[q.id] = toggle(drafts[q.id], option.label, q.multiSelect);
                    for (const other of list.children) {
                        other.setAttribute('aria-pressed', String(drafts[q.id].options.includes(other.querySelector('.label').textContent)));
                    }
                    refresh();
                };
                list.append(b);
            }
            block.append(list);
        }
        if (q.allowCustom) {
            const input = el('input', 'field ask-custom');
            input.placeholder = q.options.length ? '其他回答（可选）' : '写下你的回答';
            input.value = drafts[q.id].custom;
            input.oninput = () => { drafts[q.id].custom = input.value; refresh(); };
            block.append(input);
        }
        card.append(block);
    }

    const actions = el('div', 'ask-actions');
    if (sets.length > 1) actions.append(el('span', 'quiet more', `还有 ${sets.length - 1} 组问题`));
    const decline = el('button', 'quiet', '不回答');
    decline.onclick = () => replyAsk(s, set, declineCall(set), [submit, decline]);
    submit.onclick = () => replyAsk(s, set, answerCall(set, drafts), [submit, decline]);
    actions.append(decline, submit);
    card.append(actions);
    box.append(card);
    refresh();
}

/** Call one of the session CLI's RPC methods; params and result are encrypted with the session key. */
/** A tool waiting for permission: what it wants to do, its full arguments behind a click, and 拒绝 / 允许. */
function approvalCard(s, set, more) {
    const d = describeApproval(set, (p) => shortHome(p, s.meta.homeDir));
    const card = el('div', 'ask-card approval');
    const head = el('div', 'ask-head');
    head.append(el('span', null, `需要你批准：${d.title}`));
    const line = el('p', 'approval-line');
    line.insertAdjacentHTML('beforeend', iconSvg(d.icon));
    line.append(el('span', null, d.text));
    card.append(head, line);
    if (d.where) card.append(el('p', 'approval-where', `在 ${d.where}`));
    if (d.detail && d.detail !== d.text) {
        const details = el('details', 'approval-detail');
        details.append(el('summary', null, '完整内容'), el('pre', null, d.detail));
        card.append(details);
    }
    const actions = el('div', 'ask-actions');
    if (more > 0) actions.append(el('span', 'quiet more', `还有 ${more} 个请求`));
    const deny = el('button', 'quiet', '拒绝');
    const allow = el('button', 'primary', '允许');
    const buttons = [deny, allow];
    if (canApproveForSession(s.meta)) {
        const session = el('button', 'quiet', '本会话都允许');
        session.title = '这个会话里同类请求不再询问';
        session.onclick = () => replyAsk(s, set, approvalCall(set, 'session'), buttons);
        buttons.splice(1, 0, session);
    }
    deny.onclick = () => replyAsk(s, set, approvalCall(set, 'deny'), buttons);
    allow.onclick = () => {
        // The CLI leaves plan mode once a plan is approved; stop sending `plan` with every message, or it goes straight back.
        if ((set.tool === 'ExitPlanMode' || set.tool === 'exit_plan_mode') && effectivePermission(s) === 'plan') {
            setChosenPermission(s, 'default');
            renderPermissionPicker();
        }
        replyAsk(s, set, approvalCall(set, 'allow'), buttons);
    };
    actions.append(...buttons);
    card.append(actions);
    return card;
}

async function sessionRpc(s, method, params) {
    const sock = await getSocket();
    const r = await sock.timeout(15000).emitWithAck('rpc-call', {
        method: `${s.id}:${method}`,
        params: await encryptJSON(s.dataKey, params),
    });
    if (!r?.ok) throw new Error(r?.error === 'RPC method not available' ? '会话所在的电脑没有响应' : (r?.error || '调用失败'));
    return r.result ? decryptJSON(s.dataKey, r.result) : null;
}

async function replyAsk(s, set, call, buttons) {
    buttons.forEach((b) => { b.disabled = true; });
    try {
        await sessionRpc(s, call.method, call.params);
        state.askSent.add(`${s.id}:${set.id}`);
        state.askDrafts.delete(`${s.id}:${set.id}`);
        notice('');
    } catch (e) {
        notice(`没有提交成功：${e.message}`);
        buttons.forEach((b) => { b.disabled = false; });
        return;
    }
    state.askSignature = null;
    renderAsk();
    state.listSignature = null;
    renderList();
}

// ---------- Settings ----------

const BRAND = 'Happy';

/** The name in the top-left corner and the tab title; set in settings, per browser. */
function applyBrand() {
    const name = (localStorage.getItem('happy.brand') || '').trim() || BRAND;
    $('brand').textContent = name;
    // Sessions that want you, like the Mac app's Dock badge: "(2) Happy".
    document.title = state.badge ? `(${state.badge}) ${name}` : name;
}

function openSettings() {
    document.body.classList.add('in-settings', 'in-chat');
    renderSettings();
}

function closeSettings() {
    document.body.classList.remove('in-settings');
    if (!state.current) document.body.classList.remove('in-chat');
    markRead(state.current);
}

/** Default model and effort per agent; each change is saved at once. */
function renderSettings() {
    if (document.activeElement !== $('brand-input')) $('brand-input').value = localStorage.getItem('happy.brand') || '';
    renderNotifySetting();
    const defaults = loadDefaults();
    const box = $('defaults');
    box.replaceChildren();
    for (const agent of DEFAULT_AGENTS) {
        const d = defaults[agent.id] ?? {};
        const rowEl = el('div', 'default-row');
        rowEl.append(el('div', 'agent-name', agent.name));

        const model = el('select', 'field');
        model.setAttribute('aria-label', `${agent.name} 默认模型`);
        const none = el('option', null, '不指定');
        none.value = '';
        model.append(none);
        for (const o of agentModelOptions(agent.id)) {
            const opt = el('option', null, o.name);
            opt.value = o.key;
            model.append(opt);
        }
        model.value = d.model ?? '';
        model.onchange = () => { saveDefault(agent.id, 'model', model.value); settingsSaved(); };

        const levels = effortOptions({ flavor: agent.id }, d.model ?? '');
        const effort = el('select', 'field');
        effort.setAttribute('aria-label', `${agent.name} 默认强度`);
        const noneEffort = el('option', null, '不指定');
        noneEffort.value = '';
        effort.append(noneEffort);
        for (const level of levels) {
            const opt = el('option', null, effortName(level));
            opt.value = level;
            effort.append(opt);
        }
        effort.value = d.effort && levels.includes(d.effort) ? d.effort : '';
        effort.hidden = levels.length === 0;
        effort.onchange = () => { saveDefault(agent.id, 'effort', effort.value); settingsSaved(); };

        const modes = agentPermissionOptions(agent.id);
        const permission = el('select', 'field');
        permission.setAttribute('aria-label', `${agent.name} 默认权限`);
        const nonePermission = el('option', null, '不指定');
        nonePermission.value = '';
        permission.append(nonePermission);
        for (const o of modes) {
            const opt = el('option', null, `${o.name}：${o.description}`);
            opt.value = o.key;
            permission.append(opt);
        }
        permission.value = d.permission && modes.some((o) => o.key === d.permission) ? d.permission : '';
        permission.onchange = () => { saveDefault(agent.id, 'permission', permission.value); settingsSaved(); };

        const fields = el('div', 'default-fields');
        fields.append(labelled('模型', model));
        if (levels.length) fields.append(labelled('强度', effort));
        if (modes.length) fields.append(labelled('权限', permission));
        rowEl.append(fields);
        box.append(rowEl);
    }
}

const NOTIFY_HINT = '只在这个标签页不在前台时通知，点通知直接打开那个会话。只对这个浏览器生效，页面要开着。';
const DESKTOP_NOTIFY_HINT = '只在窗口不在前台时通知，点通知直接打开那个会话；等你回答时 Dock 图标还会跳一下。没弹出来的话，用「帮助 › 发送测试通知」检查。Dock 角标不受这个开关影响。';

/** Notifications on/off: the same switch in a browser and in the Mac app. */
function renderNotifySetting(problem) {
    const toggle = $('notify-toggle');
    const hint = $('notify-hint');
    const supported = notificationsSupported();
    const blocked = supported && Notification.permission === 'denied';
    toggle.checked = notificationsOn();
    toggle.disabled = !supported;
    // Sound: the Mac app only (a browser's `silent` is not reliably honoured).
    $('notify-sound-row').hidden = !desktop.active;
    $('notify-sound').checked = notifySoundOn();
    $('notify-sound').disabled = !toggle.checked;
    hint.textContent = !supported ? '这个页面不能发通知：需要用 https 或 localhost 打开（ssh 转发到 localhost 就行）。'
        : blocked || problem === 'denied' ? '浏览器拦掉了这个网站的通知。点地址栏左边的网站设置，把「通知」改成允许，再回来打开。'
        : desktop.active ? DESKTOP_NOTIFY_HINT : NOTIFY_HINT;
    hint.classList.toggle('warn', !supported || blocked || problem === 'denied');
}

function labelled(text, control) {
    const wrap = el('label', 'labelled');
    wrap.append(el('span', null, text), control);
    return wrap;
}

function settingsSaved() {
    renderSettings();       // effort levels follow the model
    renderModelPicker();    // the open chat's "默认：…" follows too
    const note = $('settings-saved');
    note.textContent = '已保存';
    clearTimeout(settingsSaved.timer);
    settingsSaved.timer = setTimeout(() => { note.textContent = ''; }, 1500);
}

// ---------- Realtime ----------

let socket = null;

/** One account-wide socket for pushes and archive RPCs; reconnects on its own. */
function connectSocket() {
    socket?.disconnect();
    socket = io(state.server, {
        path: '/v1/updates',
        auth: { token: state.token, clientType: 'user-scoped' },
        transports: ['websocket'],
    });
    socket.on('connect', () => {
        // Fill whatever happened while we were away.
        pollMessages();
        syncSessions().catch((e) => console.error(e));
    });
    socket.on('update', (u) => onUpdate(u?.body).catch((e) => console.error(e)));
    socket.on('ephemeral', onEphemeral);
}

async function onUpdate(body) {
    if (!body) return;
    if (body.t === 'new-message') {
        const s = state.sessions.get(body.sid);
        if (!s) return;
        s.seq = Math.max(s.seq ?? 0, body.message?.seq ?? 0);
        sessionChanged(s);
        await acceptMessage(s, body.message);
        if (viewing(s)) markRead(s); else renderList();
        return;
    }
    if (body.t === 'update-session') {
        const s = state.sessions.get(body.id);
        if (!s) return;
        if (body.metadata?.value) {
            const meta = await decryptJSON(s.dataKey, body.metadata.value);
            if (meta) { s.meta = meta; s.metadataVersion = body.metadata.version; }
        }
        if (body.agentState?.value && body.agentState.version > (s.agentStateVersion ?? 0)) {
            const agentState = await decryptJSON(s.dataKey, body.agentState.value);
            if (agentState) { s.agentState = agentState; s.agentStateVersion = body.agentState.version; }
        }
        renderList();
        if (s === state.current) { renderHead(); renderModelPicker(); renderThinking(); renderAsk(); }
        return;
    }
    if (body.t === 'new-session') {
        await ingest(body);
        renderList();
    }
}

function onEphemeral(e) {
    if (e?.type === 'machine-activity') return onMachineActivity(e);
    if (e?.type !== 'activity') return;
    const s = state.sessions.get(e.id);
    if (!s) return;
    const changed = s.active !== e.active;
    s.active = e.active;
    s.activeAt = e.activeAt ?? s.activeAt;
    const stale = e.thinking && Date.now() < (s.thinkingMutedUntil ?? 0); // the keepalive that lags a turn's end
    const thinking = !!e.thinking && e.active && !stale;
    if (thinking !== !!s.thinking) sessionChanged(s);
    s.thinking = thinking;
    const thread = state.threads.get(s.id);
    if (changed && !s.active) thread?.background?.clear(); // its process is gone, and the tasks with it
    renderList(); // rebuilds only if what shows changed (a finished turn may now be unread)
    const r = $('list').querySelector(`.row[data-id="${CSS.escape(s.id)}"]`);
    if (r) { r.classList.toggle('busy', isWorking(s)); r.title = rowStatus(s); }
    if (changed && thread?.newest) refreshTurn(thread, thread.newest);
    if (s === state.current) { if (changed) renderHead(); renderThinking(); }
}

/** A computer came online or went away: whether its sessions can be resumed follows. */
function onMachineActivity(e) {
    const m = state.machines?.find((x) => x.id === e.id);
    if (!m || m.online === !!e.active) return;
    m.online = !!e.active;
    if (state.current && isDisconnected(state.current)) renderResume();
}

async function getSocket() {
    if (!socket) connectSocket();
    if (socket.connected) return socket;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('连不上服务器')), 10000);
        socket.once('connect', () => { clearTimeout(timer); resolve(); });
    });
    return socket;
}

/** Ask the session's CLI to stop; it stamps lifecycleState=archived on its way out. */
async function killSession(s, sock) {
    try {
        const r = await sock.timeout(15000).emitWithAck('rpc-call', {
            method: `${s.id}:killSession`,
            params: await encryptJSON(s.dataKey, {}),
        });
        if (!r?.ok || !r.result) return false;
        return (await decryptJSON(s.dataKey, r.result))?.success === true;
    } catch {
        return false;
    }
}

/** Write lifecycleState=archived ourselves, for a CLI that is gone. */
async function writeArchived(s, sock) {
    for (let attempt = 0; attempt < 3; attempt++) {
        if (isArchived(s)) return;
        const next = {
            ...s.meta,
            lifecycleState: 'archived',
            lifecycleStateSince: Date.now(),
            archivedBy: 'web',
            archiveReason: 'Archived from web',
        };
        const r = await sock.timeout(10000).emitWithAck('update-metadata', {
            sid: s.id,
            metadata: await encryptJSON(s.dataKey, next),
            expectedVersion: s.metadataVersion,
        });
        if (r?.result === 'success') {
            s.meta = next;
            s.metadataVersion = r.version;
            return;
        }
        if (r?.result !== 'version-mismatch') throw new Error('服务器没有接受归档');
        s.metadataVersion = r.version;
        s.meta = (r.metadata && (await decryptJSON(s.dataKey, r.metadata))) || s.meta;
    }
    if (!isArchived(s)) throw new Error('会话正在被修改，稍后再试');
}

/** The header's 归档 button, busy while the open session is being archived. */
function renderArchiveButton() {
    const busy = !!state.current?.archiving;
    $('archive').disabled = busy;
    setButton($('archive'), 'archive', busy ? '正在归档' : '归档', busy);
}

const archiveCurrent = () => archiveSession(state.current);

/** Archive a session (the open one, or one picked from the list's menu). */
async function archiveSession(s) {
    if (!s || isArchived(s) || s.archiving) return;
    const what = s === state.current ? '' : `「${sessionTitle(s)}」`;
    // Asked up front, in one dialog with the archive's own warning, so nothing pops up once it is done.
    const worktree = lastInWorktree(s);
    let dropWorktree = false;
    if (s.active || worktree) {
        const answer = await askArchive(s, what, worktree);
        if (!answer) return;
        dropWorktree = answer.dropWorktree;
    }
    if (isArchived(s) || s.archiving) return; // archived elsewhere while the dialog was up
    s.archiving = true;
    renderArchiveButton();
    // Where to go afterwards: the next session in the list, else the one before it.
    const live = liveSessions();
    const at = live.indexOf(s);
    const neighbours = at < 0 ? live : [...live.slice(at + 1), ...live.slice(0, at).reverse()];
    let archived = false;
    try {
        const sock = await getSocket();
        if (await killSession(s, sock)) {
            // Give the CLI a moment to write its own archived metadata.
            await new Promise((r) => setTimeout(r, 2500));
            await syncSessions();
        } else {
            await api('POST', `/v1/sessions/${encodeURIComponent(s.id)}/archive`).catch(() => {});
        }
        s.active = false;
        await writeArchived(s, sock);
        archived = true;
        notice('');
    } catch (e) {
        notice(`${what}归档失败：${e.message}`);
    } finally {
        s.archiving = false;
        renderArchiveButton();
        renderList();
        renderHead();
        renderAsk();
    }
    // Only if the person is still on it; they may have moved on while it was archiving.
    const next = neighbours.find((n) => n !== s && isOnline(n) && n.meta.isSideChat !== true);
    if (archived && state.current === s && next && !document.body.classList.contains('in-settings')) openSession(next);
    if (archived && dropWorktree) await dropArchivedWorktree(s, worktree);
}

/**
 * The `.dev/worktree/*` checkout the session runs in, when no other online
 * session on its computer is in it (archiving it would leave the checkout behind); else null.
 */
function lastInWorktree(s) {
    const path = worktreeOf((s.meta.path || '').trim());
    if (!path) return null;
    const others = [...state.sessions.values()].some((o) => o !== s && isOnline(o)
        && machineKey(o) === machineKey(s) && worktreeOf((o.meta.path || '').trim()) === path);
    return others ? null : path;
}

/**
 * The archive dialog: the warning for a running session, and 「同时删除 worktree」
 * when it is the checkout's last session. Resolves to { dropWorktree }, or null when cancelled.
 */
function askArchive(s, what, worktree) {
    const dialog = $('archive-dialog');
    const box = $('archive-worktree');
    $('archive-title').textContent = `归档${what || '会话'}`;
    $('archive-text').textContent = s.active ? '归档后，这台电脑上的会话进程会结束，正在进行的任务会中断。' : '';
    $('archive-worktree-row').hidden = !worktree;
    box.checked = true;
    box.disabled = false;
    if (worktree) {
        $('archive-worktree-label').textContent = `同时删除 worktree「${worktree.split('/').pop()}」`;
        const note = $('archive-worktree-note');
        note.textContent = '这是它里面最后一个会话。分支已合并的话一并删除，没合并的保留。';
        // Removing it goes through the computer's daemon: no use offering it while that computer is away.
        refreshMachines().then(() => {
            if (!dialog.open || machineOf(s)?.online !== false) return;
            box.checked = false;
            box.disabled = true;
            note.textContent = '这台电脑现在离线，删不了。';
        }, () => {});
    }
    dialog.returnValue = ''; // Esc leaves the last value in place
    dialog.showModal();
    return new Promise((resolve) => {
        dialog.addEventListener('close', () => {
            resolve(dialog.returnValue === 'archive' ? { dropWorktree: !!worktree && box.checked && !box.disabled } : null);
        }, { once: true });
    });
}

/** Remove the archived session's worktree (and its branch, when merged) on its computer. */
async function dropArchivedWorktree(s, path) {
    const name = path.split('/').pop();
    const m = await refreshMachines().then(() => machineOf(s), () => null);
    if (!m?.online) { notice(`这台电脑离线，worktree「${name}」没有删除`); return; }
    notice(`正在删除 worktree「${name}」…`);
    const bash = (command, cwd) => machineBash(m, command, cwd);
    try {
        let r;
        try {
            r = await removeWorktree(path, bash);
        } catch (e) {
            if (!e.dirty || !confirm(`「${name}」里有未提交的修改或未跟踪的文件，删掉后这些改动就没了。仍要删除？`)) throw e;
            r = await removeWorktree(path, bash, { force: true });
        }
        notice(`已删除 worktree「${name}」` + (r.branchDeleted ? `和分支 ${r.branch}`
            : r.branch ? `，分支 ${r.branch} 还没合并，保留了` : ''));
    } catch (e) {
        notice(`worktree「${name}」没有删除：${e.message}`);
    }
}

// ---------- List menu ----------
// Right-click on a session, a computer, a project/worktree or 已归档. Found
// through the DOM (rows carry data-id), so the list's rendering stays as is.

function markSeen(sessions) {
    let changed = false;
    for (const s of sessions) {
        if (!hasUnseen(s)) continue;
        state.seen[s.id] = s.seq ?? 0;
        changed = true;
    }
    if (changed) { saveSeen(); renderList(); }
}

/** Flag a read session as 完成未读 again, as if its last message were new. */
function markUnread(s) {
    if (!(s.seq > 0)) return;
    state.seen[s.id] = s.seq - 1;
    s.changedAt = 0; // already settled
    saveSeen();
    renderList();
}

async function copyFromMenu(text) {
    if (!(await copyText(text))) notice('复制失败');
}

const sessionsIn = (node) => [...node.querySelectorAll('.row')].map((r) => state.sessions.get(r.dataset.id)).filter(Boolean);
const foldItem = (head) => ({ label: head.getAttribute('aria-expanded') === 'true' ? '收起' : '展开', action: () => head.click() });

function sessionMenu(s) {
    const archived = isArchived(s);
    const special = !!(s.meta.bot || s.meta.task); // bots and tasks have no project to start in
    const projectPath = place(s).projectPath || s.meta.path;
    return [
        { label: '打开', action: () => openSession(s), hidden: s === state.current && !document.body.classList.contains('in-settings') },
        { label: '标为已读', icon: 'copied', hidden: !hasUnseen(s), action: () => markSeen([s]) },
        { label: '标为未读', icon: 'unread', hidden: archived || hasUnseen(s) || s === state.current || !(s.seq > 0), action: () => markUnread(s) },
        '-',
        { label: '在这个项目新建会话', icon: 'newChat', hidden: special || !projectPath || !s.meta.machineId, action: () => openNewSession(s.meta.machineId, projectPath) },
        { label: '复制目录路径', icon: 'copy', hidden: !s.meta.path, action: () => copyFromMenu(s.meta.path) },
        { label: '复制会话 ID', icon: 'copy', action: () => copyFromMenu(s.id) },
        '-',
        { label: s.resuming ? '正在恢复…' : '恢复会话', icon: 'resume', hidden: !isDisconnected(s) || !resumeAvailability(s, machineOf(s)).show, disabled: s.resuming || !resumeAvailability(s, machineOf(s)).ok, action: () => resumeSession(s) },
        { label: s.archiving ? '正在归档…' : '归档', icon: 'archive', danger: true, hidden: archived, disabled: s.archiving, action: () => archiveSession(s) },
    ];
}

function groupMenu(head) {
    const box = head.parentElement;
    const sessions = sessionsIn(box);
    const fold = foldItem(head);
    if (box.classList.contains('archived')) return [fold];
    const read = { label: '全部标为已读', icon: 'copied', hidden: !sessions.some(hasUnseen), action: () => markSeen(sessions) };
    const first = sessions[0];
    if (head.classList.contains('group-head')) {
        // A computer.
        return [
            { label: '在这台电脑上新建会话', icon: 'newChat', hidden: !first?.meta.machineId, action: () => openNewSession(first.meta.machineId) },
            read, '-', fold,
        ];
    }
    // A project or one of its worktrees.
    const p = first && place(first);
    const dir = !p ? '' : box.classList.contains('worktree') && p.worktree ? p.projectPath + WORKTREE_MARKER + p.worktree : p.projectPath;
    return [
        { label: '在这里新建会话', icon: 'newChat', hidden: !dir || !first.meta.machineId, action: () => openNewSession(first.meta.machineId, dir) },
        { label: '复制路径', icon: 'copy', hidden: !dir, action: () => copyFromMenu(dir) },
        read, '-', fold,
    ];
}

$('list').addEventListener('contextmenu', (e) => {
    const r = e.target.closest('.row');
    const s = r && state.sessions.get(r.dataset.id);
    if (s && isDisconnected(s)) refreshMachines().catch((err) => console.error(err)); // for 恢复会话 next time, if stale now
    if (s) return openMenu(e, sessionMenu(s), r);
    const head = e.target.closest('.group-head, .tree-head');
    if (head) openMenu(e, groupMenu(head), head);
});

// ---------- New session ----------

const AGENTS = [['claude', 'Claude Code'], ['codex', 'Codex'], ['gemini', 'Gemini']];
const newSession = { machines: [], busy: false, worktrees: null, worktreesFor: null, worktreeTimer: null };
const WT_NEW = '\u0000new'; // the Worktree select's 「新建 worktree」; '' is none, anything else an existing checkout's path

/** The account's machines whose key we can open, online ones first. */
async function loadMachines() {
    const list = await api('GET', '/v1/machines');
    const machines = [];
    for (const raw of list) {
        const dataKey = unwrapDataKey(state.keys, raw.dataEncryptionKey);
        if (!dataKey) continue; // legacy secret-box machines are not supported
        const meta = (raw.metadata && (await decryptJSON(dataKey, raw.metadata))) || {};
        const daemon = raw.daemonState ? await decryptJSON(dataKey, raw.daemonState) : null;
        const online = raw.active && daemon?.status !== 'shutting-down';
        machines.push({ id: raw.id, dataKey, meta, online, activeAt: raw.activeAt ?? 0 });
    }
    return machines.sort((a, b) => Number(b.online) - Number(a.online) || machineName(a).localeCompare(machineName(b), 'zh'));
}

const machineName = (m) => m.meta.displayName || m.meta.host || m.id.slice(0, 8);

/** Paths sessions on this machine ran in, newest first. */
function recentPaths(machineId) {
    const seen = new Map();
    for (const s of state.sessions.values()) {
        if (s.meta.machineId !== machineId || !s.meta.path || s.meta.isSideChat === true) continue;
        const path = place(s).projectPath || s.meta.path;
        seen.set(path, Math.max(seen.get(path) ?? 0, s.updatedAt ?? 0));
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 8);
}

const shortHome = (path, home) => (home && (path === home || path.startsWith(home + '/')) ? '~' + path.slice(home.length) : path);
const expandHome = (path, home) => (home && (path === '~' || path.startsWith('~/')) ? home + path.slice(1) : path);

function renderNewForm(clearError = true) {
    const m = newSession.machines.find((x) => x.id === $('new-machine').value);
    const home = m?.meta.homeDir;
    const recent = $('new-recent');
    recent.replaceChildren(...(m ? recentPaths(m.id) : []).map((path) => {
        const b = el('button', null, shortHome(path, home));
        b.type = 'button';
        b.title = path;
        b.onclick = () => { $('new-dir').value = shortHome(path, home); $('new-dir').focus(); onNewDirChanged(); };
        return b;
    }));
    const agent = $('new-agent');
    const keep = agent.value;
    const available = m?.meta.cliAvailability;
    agent.replaceChildren(...AGENTS
        .filter(([key]) => !available || available[key] !== false || key === 'claude')
        .map(([key, name]) => { const o = el('option', null, name); o.value = key; return o; }));
    agent.value = [...agent.options].some((o) => o.value === keep) ? keep : 'claude';
    $('new-submit').disabled = !m || !m.online || newSession.busy;
    if (m && !m.online) $('new-error').textContent = '这台电脑不在线（daemon 没有运行）。';
    else if (clearError) $('new-error').textContent = '';
    renderWorktreeSelect();
    scheduleWorktreeList();
}

/** The 目录 field as an absolute path on the picked machine, or null. */
function typedDirectory(m) {
    const typed = $('new-dir').value.trim();
    if (!m || !typed) return null;
    const directory = expandHome(typed, m.meta.homeDir).replace(/(.)\/+$/, '$1');
    return directory.startsWith('/') || /^[A-Za-z]:[\\/]/.test(directory) ? directory : null;
}

/** A shell command on the machine through its daemon (`bash` RPC); never throws. */
async function machineBash(m, command, cwd) {
    try {
        const r = await machineRpc(m, 'bash', { command, cwd });
        return { success: !!r?.success, stdout: r?.stdout ?? '', stderr: r?.stderr || r?.error || '', exitCode: r?.exitCode ?? -1 };
    } catch (e) {
        return { success: false, stdout: '', stderr: e.message, exitCode: -1 };
    }
}

/**
 * The Worktree select: none, a new one, then the repository's other checkouts
 * once listed. A directory that is itself one of them starts selected on it.
 */
function renderWorktreeSelect() {
    const select = $('new-worktree');
    const keep = select.value;
    const m = newSession.machines.find((x) => x.id === $('new-machine').value);
    const directory = typedDirectory(m);
    const listed = newSession.worktreesFor === (m && directory && `${m.id}\u0000${repoOf(directory)}`);
    const worktrees = listed ? newSession.worktrees : undefined; // undefined: not listed yet; null: not a git repository
    const option = (value, text, title) => { const o = el('option', null, text); o.value = value; if (title) o.title = title; return o; };
    const fresh = option(WT_NEW, worktrees === null ? '新建 worktree（这个目录不是 git 仓库）' : '新建 worktree');
    fresh.disabled = worktrees === null;
    select.replaceChildren(option('', '不用，直接在这个目录里'), fresh,
        ...(worktrees ?? []).map((w) => option(w.path, `${w.branch}（已有）`, w.path)));
    const values = [...select.options].filter((o) => !o.disabled).map((o) => o.value);
    select.value = values.includes(keep) && keep !== '' ? keep
        : directory && values.includes(directory) ? directory : '';
}

function onNewDirChanged() {
    renderWorktreeSelect();
    scheduleWorktreeList();
}

/** List the typed directory's worktrees once typing settles. */
function scheduleWorktreeList() {
    clearTimeout(newSession.worktreeTimer);
    const m = newSession.machines.find((x) => x.id === $('new-machine').value);
    const directory = typedDirectory(m);
    const key = m && directory && `${m.id}\u0000${repoOf(directory)}`;
    if (!m?.online || !key || key === newSession.worktreesFor) return;
    newSession.worktreeTimer = setTimeout(async () => {
        const worktrees = await listWorktrees(directory, (command, cwd) => machineBash(m, command, cwd));
        // Still the same machine and directory?
        const now = newSession.machines.find((x) => x.id === $('new-machine').value);
        const nowDir = typedDirectory(now);
        if (!now || !nowDir || `${now.id}\u0000${repoOf(nowDir)}` !== key) return;
        newSession.worktrees = worktrees;
        newSession.worktreesFor = key;
        renderWorktreeSelect();
    }, 400);
}

/** `dir`, when given, fills the 目录 field (for 「在这里新建会话」 in the list's menu). */
async function openNewSession(preferMachineId, dir) {
    const dialog = $('new-session');
    $('new-error').textContent = '';
    $('new-machine').replaceChildren(el('option', null, '正在载入…'));
    $('new-submit').disabled = true;
    if (!dialog.open) dialog.showModal();
    try {
        newSession.machines = await loadMachines();
    } catch (e) {
        $('new-machine').replaceChildren();
        $('new-error').textContent = `载入电脑列表失败：${e.message}`;
        return;
    }
    const select = $('new-machine');
    select.replaceChildren(...newSession.machines.map((m) => {
        const o = el('option', null, m.online ? machineName(m) : `${machineName(m)}（离线）`);
        o.value = m.id;
        return o;
    }));
    if (newSession.machines.length === 0) {
        $('new-error').textContent = '这个账户下没有电脑。在电脑上运行 happy daemon start 后再试。';
        return;
    }
    const current = state.current;
    const prefer = preferMachineId ?? current?.meta.machineId;
    const preferred = newSession.machines.find((m) => m.id === prefer && m.online) ?? newSession.machines.find((m) => m.online) ?? newSession.machines[0];
    select.value = preferred.id;
    if (dir != null && preferred.id === preferMachineId) $('new-dir').value = shortHome(dir, preferred.meta.homeDir);
    // Start from the open chat's project when it is on that machine.
    else if (!$('new-dir').value && current && current.meta.machineId === preferred.id) {
        $('new-dir').value = shortHome(place(current).projectPath || current.meta.path || '', preferred.meta.homeDir);
    }
    renderNewForm();
    $('new-dir').focus();
}

/** Call one of a machine daemon's RPC methods, encrypted with the machine key. */
async function machineRpc(m, method, params) {
    const sock = await getSocket();
    const r = await sock.timeout(30000).emitWithAck('rpc-call', {
        method: `${m.id}:${method}`,
        params: await encryptJSON(m.dataKey, params),
    });
    if (!r?.ok) throw new Error(r?.error === 'RPC method not available' ? '这台电脑的 daemon 没有响应' : (r?.error || '调用失败'));
    return r.result ? decryptJSON(m.dataKey, r.result) : null;
}

/** The new session once the server lists it (the CLI registers it right after spawning). */
async function waitForSession(id) {
    for (let i = 0; i < 20; i++) {
        await syncSessions().catch((e) => console.error(e));
        const s = state.sessions.get(id);
        if (s) return s;
        await new Promise((r) => setTimeout(r, 500));
    }
    return null;
}

async function submitNewSession(e) {
    e.preventDefault();
    const m = newSession.machines.find((x) => x.id === $('new-machine').value);
    const typed = $('new-dir').value.trim();
    if (!m || !typed || newSession.busy) return;
    let directory = typedDirectory(m);
    if (!directory) {
        $('new-error').textContent = '请填绝对路径，或以 ~ 开头的路径。';
        return;
    }
    const worktree = $('new-worktree').value;
    newSession.busy = true;
    const button = $('new-submit');
    button.disabled = true;
    button.textContent = '正在启动';
    $('new-error').textContent = '';
    let made = null;
    try {
        if (worktree === WT_NEW) {
            button.textContent = '正在建 worktree';
            made = await createWorktree(directory, (command, cwd) => machineBash(m, command, cwd));
            directory = made.path;
            newSession.worktreesFor = null; // the list has one more now
            button.textContent = '正在启动';
        } else if (worktree) {
            directory = worktree;
        }
        const params = { type: 'spawn-in-directory', directory, approvedNewDirectoryCreation: false, agent: $('new-agent').value };
        let r = await machineRpc(m, 'spawn-happy-session', params);
        if (r?.type === 'requestToApproveDirectoryCreation') {
            if (!confirm(`${r.directory} 不存在，要在这台电脑上创建它吗？`)) return;
            r = await machineRpc(m, 'spawn-happy-session', { ...params, approvedNewDirectoryCreation: true });
        }
        if (r?.type === 'error') throw new Error(r.errorMessage || r.message || '启动失败');
        if (r?.type !== 'success' || !r.sessionId) throw new Error('电脑返回了无法识别的结果');
        button.textContent = '正在打开';
        const s = await waitForSession(r.sessionId);
        $('new-session').close();
        $('new-dir').value = '';
        $('new-worktree').value = '';
        if (s) openSession(s); else notice('会话已启动，稍后会出现在列表里。');
    } catch (err) {
        $('new-error').textContent = made
            ? `worktree ${made.branch} 已经建好（${shortHome(made.path, m.meta.homeDir)}），但会话没有启动成功：${err.message}`
            : `没有启动成功：${err.message}`;
    } finally {
        newSession.busy = false;
        button.textContent = '开始';
        renderNewForm(false);
    }
}

// ---------- Boot ----------

function autosize() {
    const input = $('input');
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
}

async function showApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    $('messages').replaceChildren(el('p', 'placeholder', '从左边选一个会话。'));
    renderHead();
    try {
        await syncSessions();
        openFirstSession();
    } catch (e) {
        notice(e.message);
    }
    connectSocket();
    clearInterval(state.listTimer);
    state.listTimer = setInterval(() => syncSessions().catch((e) => console.error(e)), 30000);
}

/** On arrival, go straight to the first unread session in list order, else the first one. */
function openFirstSession() {
    if (state.current || document.body.classList.contains('in-settings')) return;
    const sessions = liveSessions();
    const s = sessions.find(hasUnseen) ?? sessions[0]; // on arrival: whether it still works is not known yet
    if (s) openSession(s);
}

// ---------- Sidebar width ----------
// Dragged by the handle between the list and the chat; kept per browser.

const SIDE_DEFAULT = 300;
const SIDE_MIN = 220;
const sideMax = () => Math.max(SIDE_MIN, Math.min(640, window.innerWidth - 360));

function setSideWidth(px, save = true) {
    const w = Math.round(Math.min(sideMax(), Math.max(SIDE_MIN, px)));
    $('app').style.setProperty('--side-width', `${w}px`);
    $('resizer').setAttribute('aria-valuenow', String(w));
    if (save) {
        if (w === SIDE_DEFAULT) localStorage.removeItem('happy.sideWidth');
        else localStorage.setItem('happy.sideWidth', String(w));
    }
}

function savedSideWidth() {
    return Number(localStorage.getItem('happy.sideWidth')) || SIDE_DEFAULT;
}

function initResizer() {
    const handle = $('resizer');
    handle.setAttribute('aria-valuemin', String(SIDE_MIN));
    setSideWidth(savedSideWidth(), false);
    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        const left = document.querySelector('aside').getBoundingClientRect().left;
        document.body.classList.add('resizing');
        const move = (ev) => setSideWidth(ev.clientX - left, false);
        const up = (ev) => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', up);
            document.body.classList.remove('resizing');
            setSideWidth(ev.clientX - left);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', () => setSideWidth(SIDE_DEFAULT));
    handle.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 64 : 16;
        const now = Number(handle.getAttribute('aria-valuenow')) || SIDE_DEFAULT;
        if (e.key === 'ArrowLeft') setSideWidth(now - step);
        else if (e.key === 'ArrowRight') setSideWidth(now + step);
        else if (e.key === 'Home') setSideWidth(SIDE_MIN);
        else if (e.key === 'End') setSideWidth(sideMax());
        else return;
        e.preventDefault();
    });
    // A narrower window clamps the width without forgetting the saved one.
    window.addEventListener('resize', () => {
        handle.setAttribute('aria-valuemax', String(sideMax()));
        setSideWidth(savedSideWidth(), false);
    });
    handle.setAttribute('aria-valuemax', String(sideMax()));
}
initResizer();

/** Hide or show the sidebar (wide screens only; on phones the list is its own page). */
function setSideCollapsed(collapsed) {
    document.body.classList.toggle('side-collapsed', collapsed);
    $('side-expand').hidden = !collapsed;
    if (collapsed) localStorage.setItem('happy.sideCollapsed', '1'); else localStorage.removeItem('happy.sideCollapsed');
}
setButton($('side-collapse'), 'sideClose', '');
setButton($('side-expand'), 'sideOpen', '');
$('side-collapse').onclick = () => { setSideCollapsed(true); $('side-expand').focus(); };
$('side-expand').onclick = () => { setSideCollapsed(false); $('side-collapse').focus(); };
document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'b' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if ($('app').hidden || window.matchMedia('(max-width: 760px)').matches) return;
    e.preventDefault();
    setSideCollapsed(!document.body.classList.contains('side-collapsed'));
});
setSideCollapsed(localStorage.getItem('happy.sideCollapsed') === '1');

// Reset times pass while a chat sits open.
setInterval(renderUsage, 60000);

// One clock for the running turn of the open chat.
setInterval(() => {
    const thread = state.current && state.threads.get(state.current.id);
    if (thread?.newest?.el.classList.contains('running')) tickTurn(thread.newest, true);
    if (state.thinkingNode?.parentElement === thread?.el) tickBackground();
    if (thread?.awaiting && !awaiting(thread)) { thread.awaiting = null; renderThinking(); }
}, 1000);

setButton($('new-open'), 'newChat', '');
setButton($('logout'), 'logout', '退出登录');
setButton($('settings-open'), 'settings', '');
setButton($('settings-back'), 'back', '返回');
setButton($('back'), 'back', '返回');
setButton($('archive'), 'archive', '归档');
setButton($('attach'), 'image', '');
setButton($('send'), 'send', '发送');
setButton($('stop'), 'stop', '停止');
$('stop').onclick = stopCurrent;

$('server').value = state.server;
$('login-secret').onclick = loginWithSecret;
$('login-qr').onclick = loginWithQR;
$('logout').onclick = () => { closeSettings(); logout(); };
$('settings-open').onclick = openSettings;
$('settings-back').onclick = closeSettings;
$('brand-input').addEventListener('input', () => {
    const name = $('brand-input').value.trim();
    if (name) localStorage.setItem('happy.brand', name); else localStorage.removeItem('happy.brand');
    applyBrand();
});
$('brand-input').addEventListener('change', settingsSaved);
$('notify-toggle').addEventListener('change', async () => {
    const result = await setNotifications($('notify-toggle').checked);
    renderNotifySetting(result);
    if (result === 'on' || result === 'off') settingsSaved();
});
$('notify-sound').addEventListener('change', () => {
    setNotifySound($('notify-sound').checked);
    settingsSaved();
});
applyBrand();
document.addEventListener('visibilitychange', () => markRead(state.current));
window.addEventListener('focus', () => markRead(state.current));

// ---------- Mac app ----------
// Menu commands and notification clicks from desktop/ (no-ops in a browser).
if (desktop.platform === 'darwin') document.body.classList.add('desktop-mac');
desktop.onCommand((name) => {
    if ($('app').hidden) return; // signed out: nothing to act on
    if (name === 'new-session') openNewSession();
    else if (name === 'settings') openSettings();
    else if (name === 'toggle-sidebar') setSideCollapsed(!document.body.classList.contains('side-collapsed'));
});
desktop.onOpenSession((id) => {
    const s = state.sessions.get(id);
    if (s) openSession(s);
});
$('new-open').onclick = () => openNewSession();
$('new-form').addEventListener('submit', submitNewSession);
$('new-cancel').onclick = () => $('new-session').close();
$('new-machine').onchange = () => { $('new-dir').value = ''; renderNewForm(); };
$('new-dir').addEventListener('input', () => onNewDirChanged());
$('archive').onclick = archiveCurrent;
$('archive-cancel').onclick = () => $('archive-dialog').close();
$('resume').onclick = () => resumeSession(state.current);
$('send').onclick = send;
$('attach').onclick = () => $('file').click();
$('file').onchange = () => { addImages([...$('file').files]); $('file').value = ''; };
$('input').addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') renderSlash();
});
$('input').addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addImages(files); }
});
for (const type of ['dragenter', 'dragover']) {
    $('composer').addEventListener(type, (e) => {
        if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
        e.preventDefault();
        $('composer').classList.add('dropping');
    });
}
$('composer').addEventListener('dragleave', (e) => {
    if (!$('composer').contains(e.relatedTarget)) $('composer').classList.remove('dropping');
});
$('composer').addEventListener('drop', (e) => {
    $('composer').classList.remove('dropping');
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    addImages([...e.dataTransfer.files]);
});
$('model').onchange = () => {
    const s = state.current;
    if (!s) return;
    const key = $('model').value;
    if (key) localStorage.setItem(`happy.model.${s.id}`, key); else localStorage.removeItem(`happy.model.${s.id}`);
    renderEffortPicker(); // levels depend on the model
};
$('effort').onchange = () => {
    const s = state.current;
    if (!s) return;
    const level = $('effort').value;
    if (level) localStorage.setItem(`happy.effort.${s.id}`, level); else localStorage.removeItem(`happy.effort.${s.id}`);
};
$('permission').onchange = () => {
    const s = state.current;
    if (!s) return;
    setChosenPermission(s, $('permission').value);
    renderPermissionPicker();
};
$('back').onclick = () => document.body.classList.remove('in-chat');
$('input').addEventListener('input', () => { autosize(); renderSlash(); renderActions(); });
$('input').addEventListener('click', renderSlash);
$('input').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $('input')) hideSlash(); }, 0));
handleCopyClicks($('scroll'));
$('scroll').addEventListener('scroll', () => {
    const s = state.current;
    const thread = s && state.threads.get(s.id);
    if (thread?.hasOlder && $('scroll').scrollTop < 300) loadOlder(s, thread).catch((e) => console.error(e));
}, { passive: true });
$('input').addEventListener('keydown', (e) => {
    // Keys that confirm an IME candidate (pinyin etc.) must not send or pick.
    if (e.isComposing || e.keyCode === 229) return;
    if (slashKey(e)) { e.preventDefault(); return; }
    if (historyKey(e)) { e.preventDefault(); return; }
    if (e.key !== 'Enter' || e.shiftKey) return; // Shift+Enter: newline
    e.preventDefault();
    send();
});
$('insecure').hidden = window.isSecureContext;

const saved = localStorage.getItem('happy.secret');
if (saved && state.token) {
    accountKeys(unb64(saved)).then((keys) => { state.keys = keys; showApp(); });
}
