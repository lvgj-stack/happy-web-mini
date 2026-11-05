// Agent text is markdown and may contain raw HTML: parse with marked, then
// sanitize with DOMPurify before it touches innerHTML.
import { Marked } from './node_modules/marked/lib/marked.esm.js';
import DOMPurify from './node_modules/dompurify/dist/purify.es.mjs';
import hljs from './node_modules/@highlightjs/cdn-assets/es/highlight.min.js';

const marked = new Marked({ gfm: true, breaks: true });

const escapeHtml = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Code blocks are highlighted by highlight.js (it escapes the code itself);
// a named language is used when known, else it guesses for blocks that look like code.
marked.use({
    renderer: {
        code({ text, lang }) {
            const name = (lang || '').trim().split(/\s+/)[0].toLowerCase();
            let html;
            let shown = name;
            try {
                if (name && hljs.getLanguage(name)) {
                    html = hljs.highlight(text, { language: name, ignoreIllegals: true }).value;
                } else if (!name && text.length < 20000) {
                    const guess = hljs.highlightAuto(text);
                    if (guess.relevance >= 5) { html = guess.value; shown = guess.language || ''; }
                }
            } catch { /* fall through to plain text */ }
            const label = shown ? `<span class="code-lang">${escapeHtml(shown)}</span>` : '';
            return `<pre>${label}<code class="hljs${shown ? ` language-${escapeHtml(shown)}` : ''}">${html ?? escapeHtml(text)}</code></pre>\n`;
        },
    },
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
    }
});

const clean = (htmlText) => DOMPurify.sanitize(htmlText, { FORBID_TAGS: ['style', 'form', 'input', 'button'] });

export const renderMarkdown = (text) => clean(marked.parse(text));
export const renderInlineMarkdown = (text) => clean(marked.parseInline(text));
