// Query the Codex installed on the session's computer through Happy's bash RPC.
// Only initialize, config/read and model/list are sent; no thread is created.
function queryScript() {
    const { spawn } = require('node:child_process');
    const { createInterface } = require('node:readline');
    const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
        stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
        shell: process.platform === 'win32',
    });
    const lines = createInterface({ input: child.stdout });
    let finished = false;
    let configRead = false;
    let modelsRead = false;
    let configuredModel = null;
    let configuredEffort = null;
    let listId = 3;
    const models = [];
    const cursors = new Set();
    const timer = setTimeout(() => finish('Codex model query timed out'), 10000);

    function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        lines.close();
        process.stdout.write(JSON.stringify(error ? { error } : { models, configuredModel, configuredEffort }) + '\n');
        child.stdin.destroy();
        if (process.platform === 'win32' && child.pid) {
            // A .cmd shim adds a shell process; terminate its descendants too.
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
            killer.on('error', () => child.kill());
        } else child.kill();
        const killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
        child.once('close', () => clearTimeout(killTimer));
    }
    function send(message) {
        if (!finished) child.stdin.write(JSON.stringify(message) + '\n');
    }
    function complete() {
        if (configRead && modelsRead) finish();
    }
    child.on('error', () => finish('Could not start codex app-server'));
    child.stdin.on('error', () => finish('Codex app-server input closed'));
    child.on('exit', () => { if (!finished) finish('Codex app-server exited before returning models'); });
    lines.on('line', (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (finished) return;
        // Never execute a server-initiated request while discovering models.
        if (message.method && message.id != null) {
            send({ id: message.id, error: { code: -32601, message: 'Model discovery only' } });
            return;
        }
        if (message.id === 1) {
            if (message.error) return finish('Codex initialization failed');
            send({ method: 'initialized' });
            send({ id: 2, method: 'config/read', params: { includeLayers: false, cwd: process.cwd() } });
            send({ id: listId, method: 'model/list', params: { limit: 100, includeHidden: false } });
        } else if (message.id === 2) {
            // Older versions may not support config/read; model/list still works.
            configuredModel = message.result?.config?.model ?? null;
            configuredEffort = message.result?.config?.model_reasoning_effort ?? null;
            configRead = true;
            complete();
        } else if (message.id === listId) {
            if (message.error || !Array.isArray(message.result?.data)) return finish('Codex model/list failed');
            for (const model of message.result.data) {
                if (model.hidden) continue;
                // Return only catalog fields, never the rest of config/read (credentials, etc.).
                models.push({
                    model: model.model, id: model.id, displayName: model.displayName,
                    description: model.description, supportedReasoningEfforts: model.supportedReasoningEfforts,
                    defaultReasoningEffort: model.defaultReasoningEffort,
                });
            }
            const cursor = message.result.nextCursor;
            if (cursor) {
                if (cursors.has(cursor)) return finish('Codex returned a repeated model cursor');
                cursors.add(cursor);
                send({ id: ++listId, method: 'model/list', params: { cursor, limit: 100, includeHidden: false } });
            } else {
                modelsRead = true;
                complete();
            }
        }
    });
    send({ id: 1, method: 'initialize', params: {
        clientInfo: { name: 'happy-web-mini', version: '1.0.0' },
        capabilities: { experimentalApi: true },
    } });
}

/** Fixed, base64-encoded JS avoids shell interpolation on both POSIX and Windows. */
export function codexModelsCommand() {
    const source = `(${queryScript.toString()})()`;
    return `node -e "eval(Buffer.from('${btoa(source)}','base64').toString())"`;
}

/** Per-session cache: different computers, projects and environments never share a catalog. */
export function codexModelLoader({ now = Date.now, freshMs = 60000, retryMs = 10000 } = {}) {
    const entries = new Map();
    return {
        get: (id) => entries.get(id),
        clear: () => entries.clear(),
        load(id, bash) {
            let entry = entries.get(id);
            if (entry?.pending) return entry.pending;
            if (entry && now() - entry.at < (entry.error ? retryMs : freshMs)) return Promise.resolve(entry.catalog);
            if (!entry) { entry = { catalog: null }; entries.set(id, entry); }
            entry.pending = (async () => {
                try {
                    const result = await Promise.resolve().then(() => bash(codexModelsCommand()));
                    if (!result?.success) throw new Error(result?.error || result?.stderr || '电脑没有响应');
                    const catalog = JSON.parse(result.stdout);
                    if (catalog.error || !Array.isArray(catalog.models)) throw new Error(catalog.error || '模型列表格式不正确');
                    // A logout can discard an in-flight query. Never put its result back.
                    if (entries.get(id) === entry) { entry.catalog = catalog; entry.error = null; }
                } catch (error) {
                    if (entries.get(id) === entry) entry.error = error.message;
                } finally {
                    entry.at = now();
                    entry.pending = null;
                }
                return entries.get(id) === entry ? entry.catalog : null;
            })();
            return entry.pending;
        },
    };
}
