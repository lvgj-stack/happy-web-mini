// The agent's `<options>` block: choices Happy shows as buttons under its message.
const OPTION = /<option>([\s\S]*?)<\/option>/g;
const FENCE = /^(`{3,}|~{3,})/;

/**
 * Pull the agent's `<options>` blocks out of its text (Happy's options
 * protocol: `<options>` and `</options>` on their own lines, one
 * `<option>` per choice). Returns the text without them and the choices,
 * in order. Blocks inside code fences are left alone.
 */
export function splitOptions(text) {
    const lines = String(text ?? '').split('\n');
    const kept = [];
    const options = [];
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (fence) {
            kept.push(line);
            if (trimmed.startsWith(fence)) fence = null;
            continue;
        }
        const open = trimmed.match(FENCE);
        if (open) { fence = open[1]; kept.push(line); continue; }
        if (!trimmed.startsWith('<options>')) { kept.push(line); continue; }
        // The block runs to the line holding `</options>`, or to the end of a message still streaming.
        let block = trimmed;
        while (!block.includes('</options>') && i + 1 < lines.length) block += `\n${lines[++i]}`;
        for (const m of block.matchAll(OPTION)) {
            const choice = m[1].trim();
            if (choice) options.push(choice);
        }
    }
    return { text: options.length ? kept.join('\n').replace(/\s+$/, '') : String(text ?? ''), options };
}
