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

/**
 * { kind: 'caveat' }                     SDK note, never shown
 * { kind: 'output', text }               a command's output (empty text: nothing to show)
 * { kind: 'command', name, args, raw }   a slash command; raw = typed by a person, not the SDK's record
 * { kind: 'text', text }                 an ordinary message
 */
export function parseLocalCommand(text) {
    if (typeof text !== 'string') return { kind: 'text', text: '' };
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
