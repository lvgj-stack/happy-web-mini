// node --test: upload / download URLs the server builds for itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onServerScheme } from '../serverUrl.js';

const SERVER = 'https://happy.byte.gs';

test('the server\'s own host over http, while we talk https: use https', () => {
    // A proxy that does not pass X-Forwarded-Proto makes the server answer http://.
    assert.equal(onServerScheme('http://happy.byte.gs/v1/sessions/s/attachments/a.enc', SERVER),
        'https://happy.byte.gs/v1/sessions/s/attachments/a.enc');
    assert.equal(onServerScheme('http://happy.byte.gs/x?y=1', 'https://happy.byte.gs/'), 'https://happy.byte.gs/x?y=1');
});

test('left alone: already https, another host, an explicit other port, or an http server', () => {
    const s3 = 'https://bucket.s3.amazonaws.com/path?X-Amz-Signature=abc';
    assert.equal(onServerScheme(s3, SERVER), s3);
    assert.equal(onServerScheme('https://happy.byte.gs/v1/a', SERVER), 'https://happy.byte.gs/v1/a');
    assert.equal(onServerScheme('http://other.example/v1/a', SERVER), 'http://other.example/v1/a');
    assert.equal(onServerScheme('http://happy.byte.gs:3005/v1/a', SERVER), 'http://happy.byte.gs:3005/v1/a');
    assert.equal(onServerScheme('http://192.168.1.5:3005/v1/a', 'http://192.168.1.5:3005'), 'http://192.168.1.5:3005/v1/a');
});

test('garbage stays as it was', () => {
    assert.equal(onServerScheme('not a url', SERVER), 'not a url');
    assert.equal(onServerScheme('http://happy.byte.gs/a', 'nonsense'), 'http://happy.byte.gs/a');
});
