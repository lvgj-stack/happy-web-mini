import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exec } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { codexModelLoader, codexModelsCommand } from '../codexModels.js';

const execute = promisify(exec);
const ok = (models = [{ model: 'ferry-sol' }]) => ({ success: true, stdout: JSON.stringify({ models, configuredModel: 'ferry-sol' }) });

test('concurrent queries share one call, fresh results are reused, and sessions stay separate', async () => {
    let time = 0;
    let calls = 0;
    let resolve;
    const loader = codexModelLoader({ now: () => time });
    const bash = () => { calls++; return new Promise((r) => { resolve = r; }); };
    const first = loader.load('a', bash);
    assert.equal(loader.load('a', bash), first);
    await Promise.resolve();
    resolve(ok());
    await first;
    assert.equal(calls, 1);
    await loader.load('a', bash);
    assert.equal(calls, 1);
    await loader.load('b', () => ok([{ model: 'other-computer' }]));
    assert.equal(loader.get('a').catalog.models[0].model, 'ferry-sol');
    assert.equal(loader.get('b').catalog.models[0].model, 'other-computer');
    time = 60000;
    await loader.load('a', () => { calls++; return ok([{ model: 'new' }]); });
    assert.equal(calls, 2);
    assert.equal(loader.get('a').catalog.models[0].model, 'new');
});

test('failed refreshes keep the last catalog, back off, and retry even after a synchronous RPC failure', async () => {
    let time = 0;
    let calls = 0;
    const loader = codexModelLoader({ now: () => time });
    await loader.load('a', () => ok());
    const catalog = loader.get('a').catalog;
    time = 60000;
    const fail = () => { calls++; throw new Error('offline'); };
    assert.equal(await loader.load('a', fail), catalog);
    assert.equal(loader.get('a').error, 'offline');
    assert.equal(loader.get('a').pending, null);
    await loader.load('a', fail);
    assert.equal(calls, 1);
    time += 10000;
    await loader.load('a', () => ok([]));
    assert.deepEqual(loader.get('a').catalog.models, []);
    assert.equal(loader.get('a').error, null);
});

test('malformed RPC output and query errors are recorded without replacing a valid catalog', async () => {
    for (const result of [{ success: false, stderr: 'missing CLI' }, { success: true, stdout: 'garbage' },
        { success: true, stdout: '{"error":"timeout"}' }, { success: true, stdout: '{"models":null}' }]) {
        const loader = codexModelLoader();
        assert.equal(await loader.load('a', () => result), null);
        assert.ok(loader.get('a').error);
    }
});

test('logout discards an in-flight catalog', async () => {
    const loader = codexModelLoader();
    let resolve;
    const pending = loader.load('a', () => new Promise((r) => { resolve = r; }));
    await Promise.resolve();
    loader.clear();
    resolve(ok());
    assert.equal(await pending, null);
    assert.equal(loader.get('a'), undefined);
});

// Exercise the exact command sent through RPC against a real stdio subprocess.
const fakeCli = `#!${process.execPath}
const {createInterface}=require('node:readline');
const {appendFileSync}=require('node:fs');
const send=(message)=>process.stdout.write(JSON.stringify(message)+'\\n');
if(process.env.FAKE_MODE==='exit') process.exit(1);
createInterface({input:process.stdin}).on('line',(line)=>{
 const request=JSON.parse(line);
 appendFileSync(process.env.FAKE_LOG,JSON.stringify(request)+'\\n');
 if(request.method==='initialize') {
  process.stdout.write('startup noise\\n');
  send({id:request.id,result:{}});
 } else if(request.method==='config/read') {
  send(process.env.FAKE_MODE==='old' ? {id:request.id,error:{message:'unsupported'}} :
   {id:request.id,result:{config:{model:'wire-sol',model_reasoning_effort:'medium',api_key:'NEVER_RETURN_THIS'}}});
 } else if(request.method==='model/list') {
  if(process.env.FAKE_MODE==='error') return send({id:request.id,error:{message:'bad catalog'}});
  const page=request.params.cursor;
  send({id:request.id,result:{data:page ? [{id:'preset-astra',model:'wire-astra',displayName:'Ferry Astra 排35',supportedReasoningEfforts:[]}] :
   [{id:'preset-sol',model:'wire-sol',displayName:'Ferry Sol Max 1M',supportedReasoningEfforts:[{reasoningEffort:'low'}]}, {model:'hidden',hidden:true}],
   nextCursor:(!page || process.env.FAKE_MODE==='repeat') ? 'next-page' : null}});
 }
});
`;

async function withFakeCli(mode, run) {
    const directory = await mkdtemp(join(tmpdir(), 'happy-codex-models-'));
    const log = join(directory, 'requests.jsonl');
    try {
        await writeFile(join(directory, 'codex'), fakeCli, { mode: 0o755 });
        await writeFile(log, '');
        const result = await execute(codexModelsCommand(), {
            env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FAKE_MODE: mode, FAKE_LOG: log }, timeout: 14000,
        });
        await run(result, (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

test('stdio query initializes, handles pagination, filters hidden models and returns only safe config fields', { skip: process.platform === 'win32' }, async () => {
    await withFakeCli('normal', ({ stdout }, requests) => {
        const result = JSON.parse(stdout);
        assert.deepEqual(result.models.map((m) => m.model), ['wire-sol', 'wire-astra']);
        assert.equal(result.models[1].displayName, 'Ferry Astra 排35');
        assert.equal(result.configuredModel, 'wire-sol');
        assert.ok(!stdout.includes('NEVER_RETURN_THIS'));
        assert.deepEqual(requests.map((r) => r.method), ['initialize', 'initialized', 'config/read', 'model/list', 'model/list']);
        assert.equal(requests[4].params.cursor, 'next-page');
        assert.equal(requests[3].params.includeHidden, false);
    });
});

test('stdio query still returns models when config/read is unavailable', { skip: process.platform === 'win32' }, async () => {
    await withFakeCli('old', ({ stdout }) => {
        const result = JSON.parse(stdout);
        assert.equal(result.configuredModel, null);
        assert.equal(result.models.length, 2);
    });
});

test('stdio query reports model errors, repeated cursors and premature process exits', { skip: process.platform === 'win32' }, async () => {
    for (const mode of ['error', 'repeat', 'exit']) {
        await withFakeCli(mode, ({ stdout }) => { assert.ok(JSON.parse(stdout).error); });
    }
});
