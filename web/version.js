// Which build of the page this is, for 设置 › 关于.
//
// build-info.json sits next to index.html: desktop/build.mjs puts it in the
// Mac app, `npm start` (build-info.mjs) writes it for the browser. Opened
// some other way there is none.

import { messageTime } from './time.js';

/** build-info.json, or null when there is none. */
export async function loadBuildInfo(fetchFn = fetch) {
    try {
        const r = await fetchFn('build-info.json', { cache: 'no-store' });
        if (!r.ok) return null;
        const info = await r.json();
        return info && typeof info.commit === 'string' ? info : null;
    } catch {
        return null;
    }
}

/** { version: "1.0.1 · 1a2b3c4", detail: "Mac 应用，打包于 11月9日 18:33" } */
export function versionText(info, now = Date.now()) {
    if (!info) return { version: '未知', detail: '没有版本信息：页面不是用 npm start 或 Mac 应用打开的' };
    const version = [info.version, info.commit].filter(Boolean).join(' · ') + (info.dirty ? '（含未提交的改动）' : '');
    const at = Date.parse(info.builtAt);
    const when = Number.isFinite(at) ? messageTime(at, now) : '';
    const detail = info.source === 'web'
        ? `网页版${when ? `，${when} 启动服务时的代码` : ''}`
        : `Mac 应用${when ? `，打包于 ${when}` : ''}`;
    return { version, detail };
}
