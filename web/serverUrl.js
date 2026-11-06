// URLs a self-hosted server builds for itself (attachment upload / download).
// It takes the scheme from X-Forwarded-Proto, defaulting to http, so behind a
// proxy that does not pass it (and with no PUBLIC_URL) it answers
// http://<its own host>/… while we talk to it over https. A secure page (the
// Mac app's app://happy, any https page) then blocks the request as mixed
// content — "Failed to fetch" — and its origin no longer matches ours, so the
// token would not go with it either.

/** `url` with the server's https scheme when it is the server's own host over http; anything else as it was. */
export function onServerScheme(url, server) {
    try {
        const u = new URL(url);
        const s = new URL(server);
        if (u.protocol === 'http:' && s.protocol === 'https:' && u.host === s.host) {
            u.protocol = 'https:';
            return u.toString();
        }
    } catch { /* not URLs: leave it */ }
    return url;
}
