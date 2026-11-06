// node --test: reading the SDK's wrappers out of user messages.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLocalCommand, stripTaskNotifications } from '../localCommand.js';

const NOTE = `<task-notification>
<task-id>a31224babb24deed1</task-id>
<status>completed</status>
<summary>Agent "Reviewer" finished</summary>
<note>A task-notification fires each time this agent stops.</note>
</task-notification>`;

test('a background task notification on its own is hidden', () => {
    assert.deepEqual(parseLocalCommand(NOTE), { kind: 'hidden' });
    assert.deepEqual(parseLocalCommand(`  ${NOTE}\n${NOTE}\n`), { kind: 'hidden' });
    assert.deepEqual(
        parseLocalCommand('<task-notification>nested <task-notification>x</task-notification></task-notification>'),
        { kind: 'hidden' },
    );
});

test('text after the notification is still shown', () => {
    assert.deepEqual(parseLocalCommand(`${NOTE}\n继续修`), { kind: 'text', text: '继续修' });
    assert.deepEqual(parseLocalCommand(`${NOTE}\n/compact`), { kind: 'command', name: 'compact', args: null, raw: true });
});

test('only complete leading wrappers are stripped', () => {
    assert.equal(stripTaskNotifications('<task-notification>unfinished'), '<task-notification>unfinished');
    assert.equal(stripTaskNotifications('Explain <task-notification> wrappers'), 'Explain <task-notification> wrappers');
    assert.deepEqual(
        parseLocalCommand('Explain <task-notification>x</task-notification>'),
        { kind: 'text', text: 'Explain <task-notification>x</task-notification>' },
    );
});
