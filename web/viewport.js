// Keep the app exactly as tall as what is on screen.
//
// On phones and foldables the on-screen keyboard shrinks only the visual
// viewport; the page stays 100vh tall and the browser scrolls it up to show the
// focused input, pushing the chat header off the top. Pinning the app's height
// to the visual viewport (and the page scroll to 0) keeps the header in view and
// lets only the message list scroll.

// Height to give the app, or null to leave it alone (pinch-zoomed in: the
// visual viewport is then a magnified part of the page, not the free space).
export function appHeight(vv) {
    if (!vv || vv.scale > 1.01) return null;
    return Math.round(vv.height);
}

export function fitToViewport(win = window) {
    const vv = win.visualViewport;
    if (!vv) return;
    const root = win.document.documentElement;
    const fit = () => {
        const h = appHeight(vv);
        if (h == null) return;
        root.style.setProperty('--app-height', `${h}px`);
        if (win.scrollY || win.scrollX) win.scrollTo(0, 0);
    };
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    fit();
}
