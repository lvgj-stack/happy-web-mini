// Copy buttons for rendered markdown: one per code block, one per agent message.
import { iconSvg } from './tools.js';

/**
 * Put text on the clipboard. The async Clipboard API needs a secure context
 * (https, localhost, the Mac app's app://); plain http falls back to a hidden
 * textarea and execCommand. Resolves to whether it worked.
 */
export async function copyText(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
        try { await navigator.clipboard.writeText(text); return true; } catch { /* try the fallback */ }
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    const focused = document.activeElement;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ok stays false */ }
    area.remove();
    focused?.focus?.({ preventScroll: true });
    return ok;
}

const sources = new WeakMap(); // copy button -> the text it copies

function copyButton(className, label, text) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `copy-btn ${className}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = iconSvg('copy', 14);
    button.dataset.label = label;
    sources.set(button, text);
    return button;
}

/**
 * Add copy buttons to a rendered markdown node: each code block gets one in
 * its corner (next to the language label), and when `source` is given the
 * whole message gets one that copies the original markdown.
 */
export function addCopyButtons(node, source) {
    for (const pre of node.querySelectorAll('pre')) {
        const code = pre.querySelector('code');
        if (!code) continue;
        // Wrap the block so the buttons stay put while the code scrolls sideways.
        const wrap = document.createElement('div');
        wrap.className = 'code-block';
        pre.replaceWith(wrap);
        const tools = document.createElement('div');
        tools.className = 'code-tools';
        const lang = pre.querySelector('.code-lang');
        if (lang) tools.append(lang);
        tools.append(copyButton('code-copy', '复制代码', code.textContent.replace(/\n$/, '')));
        wrap.append(pre, tools);
    }
    if (source != null) node.append(copyButton('msg-copy', '复制全文（Markdown）', source));
}

/** One delegated click handler for every copy button under `root`. */
export function handleCopyClicks(root) {
    root.addEventListener('click', async (e) => {
        const button = e.target.closest?.('.copy-btn');
        if (!button || !sources.has(button)) return;
        e.preventDefault();
        e.stopPropagation(); // e.g. don't toggle a folded turn
        const ok = await copyText(sources.get(button));
        clearTimeout(button._reset);
        button.classList.toggle('copied', ok);
        button.innerHTML = iconSvg(ok ? 'copied' : 'copy', 14);
        button.title = ok ? '已复制' : '复制失败';
        button._reset = setTimeout(() => {
            button.classList.remove('copied');
            button.innerHTML = iconSvg('copy', 14);
            button.title = button.dataset.label;
        }, 1500);
    });
}
