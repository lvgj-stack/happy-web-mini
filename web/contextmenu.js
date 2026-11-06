// A small right-click menu: one open at a time, placed at the pointer (kept
// inside the window), driven by mouse or keyboard (↑↓ Home End, Enter, Esc).
import { iconSvg } from './tools.js';

const MARGIN = 6;

/**
 * Where a w×h menu goes for a click at (x, y) in a vw×vh window: at the
 * pointer, flipped to the other side of it when it would run off an edge,
 * and clamped to the window as a last resort.
 */
export function menuPosition(x, y, w, h, vw, vh, margin = MARGIN) {
    let left = x + w + margin > vw ? x - w : x;
    let top = y + h + margin > vh ? y - h : y;
    left = Math.max(margin, Math.min(left, vw - w - margin));
    top = Math.max(margin, Math.min(top, vh - h - margin));
    return { left, top };
}

/** Keep the items that are shown, with no separator at either end or two in a row. */
export function visibleItems(items) {
    const out = [];
    for (const item of items) {
        if (!item || item.hidden) continue;
        if (item === '-' && (out.length === 0 || out[out.length - 1] === '-')) continue;
        out.push(item);
    }
    while (out[out.length - 1] === '-') out.pop();
    return out;
}

let open = null; // { menu, anchor, restore, cleanup }

export function closeMenu(restoreFocus = false) {
    if (!open) return;
    const { menu, anchor, restore, cleanup } = open;
    open = null;
    cleanup();
    menu.remove();
    anchor?.classList.remove('menu-open');
    if (restoreFocus) restore?.focus?.({ preventScroll: true });
}

/**
 * Open a menu for a `contextmenu` event. `items`: { label, icon?, danger?,
 * disabled?, hidden?, action } or '-' for a separator. `anchor` gets the
 * `menu-open` class while the menu is up and places it when the event came
 * from the keyboard (no pointer position).
 */
export function openMenu(e, items, anchor = e.currentTarget) {
    const shown = visibleItems(items);
    closeMenu();
    if (!shown.length) return;
    e.preventDefault();

    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.setAttribute('role', 'menu');
    menu.tabIndex = -1;
    for (const item of shown) {
        if (item === '-') {
            const sep = document.createElement('div');
            sep.className = 'ctx-sep';
            sep.setAttribute('role', 'separator');
            menu.append(sep);
            continue;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ctx-item' + (item.danger ? ' danger' : '');
        b.setAttribute('role', 'menuitem');
        b.tabIndex = -1;
        b.disabled = !!item.disabled;
        if (item.icon) { b.dataset.icon = item.icon; b.insertAdjacentHTML('beforeend', iconSvg(item.icon, 15)); }
        else b.append(Object.assign(document.createElement('span'), { className: 'ctx-pad' }));
        b.append(Object.assign(document.createElement('span'), { className: 'label', textContent: item.label }));
        b.onclick = () => { closeMenu(true); item.action?.(); };
        menu.append(b);
    }
    document.body.append(menu);

    // A keyboard-opened menu (ContextMenu key, Shift+F10) has no pointer position.
    const fromKeyboard = (e.clientX === 0 && e.clientY === 0) || e.button === -1;
    const rect = anchor?.getBoundingClientRect();
    const x = fromKeyboard && rect ? rect.left + 16 : e.clientX;
    const y = fromKeyboard && rect ? rect.bottom : e.clientY;
    const { left, top } = menuPosition(x, y, menu.offsetWidth, menu.offsetHeight, window.innerWidth, window.innerHeight);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    anchor?.classList.add('menu-open');

    const buttons = () => [...menu.querySelectorAll('.ctx-item:not(:disabled)')];
    const move = (step) => {
        const list = buttons();
        if (!list.length) return;
        const at = list.indexOf(document.activeElement);
        const next = step === 'first' ? 0 : step === 'last' ? list.length - 1
            : at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
        list[next].focus();
    };
    menu.addEventListener('keydown', (k) => {
        if (k.key === 'ArrowDown') move(1);
        else if (k.key === 'ArrowUp') move(-1);
        else if (k.key === 'Home') move('first');
        else if (k.key === 'End') move('last');
        else if (k.key === 'Escape') closeMenu(true);
        else if (k.key === 'Tab') closeMenu(true);
        else return;
        k.preventDefault();
        k.stopPropagation();
    });
    menu.addEventListener('contextmenu', (c) => c.preventDefault());
    menu.addEventListener('mouseover', (m) => {
        const b = m.target.closest('.ctx-item');
        if (b && !b.disabled) b.focus({ preventScroll: true });
    });

    // Anything else the person does closes it.
    const outside = (p) => { if (!menu.contains(p.target)) closeMenu(); };
    const away = () => closeMenu();
    const scroll = (s) => { if (!menu.contains(s.target)) closeMenu(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('blur', away);
    window.addEventListener('resize', away);
    const cleanup = () => {
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('scroll', scroll, true);
        window.removeEventListener('blur', away);
        window.removeEventListener('resize', away);
    };
    open = { menu, anchor, restore: document.activeElement, cleanup };

    if (fromKeyboard) move('first'); else menu.focus({ preventScroll: true });
}
