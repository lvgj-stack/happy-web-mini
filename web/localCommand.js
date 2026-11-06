// What a user message says once Claude Agent SDK's slash-command wrappers are
// read. Port of happy-ios HappyCore/ChatDisplay/LocalCommandMessage.swift
// (itself from happy-app's parseLocalCommandMessage.ts).
//
// When `/foo` runs, the SDK records user messages made of tags such as
// `<command-name>/foo</command-name><command-message>foo</command-message>`;
// shown as text they read as raw markup.

const CAVEAT = /^\s*<local-command-caveat>[\s\S]*?<\/local-command-caveat>\s*$/;
const STDOUT = /^\s*<local-command-stdout>\s*([\s\S]*?)\s*<\/local-command-stdout>\s*$/;
const COMMAND_NAME = /<command-name>\s*\/?([^<]+?)\s*<\/command-name>/;
const COMMAND_ARGS = /<command-args>\s*([\s\S]*?)\s*<\/command-args>/;
const WRAPPER_TAGS = /<command-(?:message|name|args)>[\s\S]*?<\/command-(?:message|name|args)>/g;
const RAW_SLASH = /^\s*\/([a-zA-Z][A-Za-z0-9_:-]*)(?:\s+([\s\S]*?))?\s*$/;
const GOAL_SET = /^Goal set:\s*([\s\S]*?)\s*$/i;

const NOTE_OPEN = '<task-notification>';
const NOTE_CLOSE = '</task-notification>';

/**
 * Drops complete leading `<task-notification>` envelopes (nesting allowed) and
 * keeps whatever follows. When a background task (subagent, background Bash)
 * stops, the SDK feeds its result back to the model as a user message wrapped
 * like this. Port of happy-wire's stripLeadingTaskNotificationWrappers.
 * Unfinished or inline wrappers are left alone: returns `text` unchanged.
 */
export function stripTaskNotifications(text) {
    let rest = text.trimStart();
    let stripped = false;
    while (rest.startsWith(NOTE_OPEN)) {
        let depth = 1;
        let cursor = NOTE_OPEN.length;
        while (depth > 0) {
            const close = rest.indexOf(NOTE_CLOSE, cursor);
            if (close === -1) return stripped ? rest : text;
            const open = rest.indexOf(NOTE_OPEN, cursor);
            if (open !== -1 && open < close) {
                depth += 1;
                cursor = open + NOTE_OPEN.length;
            } else {
                depth -= 1;
                cursor = close + NOTE_CLOSE.length;
            }
        }
        stripped = true;
        rest = rest.slice(cursor).trimStart();
    }
    return stripped ? rest : text;
}

/**
 * { kind: 'hidden' }                     only a background task notification, never shown
 * { kind: 'caveat' }                     SDK note, never shown
 * { kind: 'output', text }               a command's output (empty text: nothing to show)
 * { kind: 'command', name, args, raw }   a slash command; raw = typed by a person, not the SDK's record
 * { kind: 'text', text }                 an ordinary message
 */
export function parseLocalCommand(text) {
    if (typeof text !== 'string') return { kind: 'text', text: '' };
    const visible = stripTaskNotifications(text);
    if (visible !== text && !visible.trim()) return { kind: 'hidden' };
    text = visible;
    if (CAVEAT.test(text)) return { kind: 'caveat' };
    const out = text.match(STDOUT);
    if (out) {
        const stdout = out[1].trim();
        return { kind: 'output', text: GOAL_SET.test(stdout) ? '' : stdout };
    }
    const raw = text.match(RAW_SLASH);
    if (raw) return { kind: 'command', name: raw[1], args: raw[2]?.trim() || null, raw: true };
    const name = text.match(COMMAND_NAME);
    if (name) {
        const rest = text.replace(WRAPPER_TAGS, '').trim();
        if (rest) return { kind: 'text', text: rest };
        const args = text.match(COMMAND_ARGS)?.[1]?.trim() || null;
        return { kind: 'command', name: name[1].trim(), args, raw: false };
    }
    return { kind: 'text', text };
}

/** "/name args" */
export function commandText(c) {
    return `/${c.name}${c.args ? ' ' + c.args : ''}`;
}
