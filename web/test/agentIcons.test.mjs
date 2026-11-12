import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFlavor, agentIconSvg } from '../agentIcons.js';

test('sessions without a flavor run on Claude', () => {
    assert.equal(agentFlavor({}), 'claude');
    assert.equal(agentFlavor(undefined), 'claude');
    assert.equal(agentFlavor({ flavor: 'codex' }), 'codex');
});

test('each known agent has its own filled logo at the asked size', () => {
    const svgs = ['claude', 'codex', 'cursor', 'gemini'].map((f) => agentIconSvg(f, 14));
    for (const svg of svgs) {
        assert.match(svg, /^<svg aria-hidden="true"[^>]* width="14" height="14"[^>]* fill="currentColor"><path d="M?[\w.\- ]/i);
    }
    assert.equal(new Set(svgs).size, 4);
});

test('an unknown agent falls back to the generic bot icon', () => {
    const svg = agentIconSvg('qwen', 14);
    assert.match(svg, /^<svg aria-hidden="true"/);
    assert.match(svg, /width="14"/);
    assert.doesNotMatch(svg, /fill="currentColor"><path d="[mM](4\.7144|22\.2819|11\.503|11\.04)/);
});
