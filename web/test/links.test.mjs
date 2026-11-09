// node --test: links in a session, gathered for the side panel.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyLink, extractLinks, normalizeUrl } from '../links.js';

test('extract: markdown links keep their text, bare URLs have none', () => {
    assert.deepEqual(extractLinks('看 [需求 Spec](https://x.feishu.cn/docx/AbC123) 和 https://github.com/a/b/pull/3'), [
        { url: 'https://x.feishu.cn/docx/AbC123', text: '需求 Spec' },
        { url: 'https://github.com/a/b/pull/3', text: null },
    ]);
    assert.deepEqual(extractLinks('[https://a.com/x](https://a.com/x)'), [{ url: 'https://a.com/x', text: null }], 'text equal to url is no text');
});

test('extract: code is skipped, only http(s), trailing punctuation dropped', () => {
    assert.deepEqual(extractLinks('```\nhttps://a.com/in-block\n```\n`https://a.com/inline` mailto:a@b.c ftp://a.com/f'), []);
    assert.deepEqual(extractLinks('见 https://x.feishu.cn/docx/AbC123。'), [{ url: 'https://x.feishu.cn/docx/AbC123', text: null }]);
    assert.deepEqual(extractLinks('(https://github.com/a/b/pull/3)'), [{ url: 'https://github.com/a/b/pull/3', text: null }]);
    assert.deepEqual(extractLinks('列表\n- 链接：https://a.com/p，然后'), [{ url: 'https://a.com/p', text: null }]);
});

test('normalize: fragment and trailing slash', () => {
    assert.equal(normalizeUrl('https://a.com/x/#h'), 'https://a.com/x');
    assert.equal(normalizeUrl('https://a.com/x?q=1#h'), 'https://a.com/x?q=1');
});

test('classify: MR / PR', () => {
    assert.deepEqual(classifyLink('https://code.byted.org/seed/fe_mono/merge_requests/1234', 'MR'), { kind: 'mr', label: 'fe_mono !1234' });
    assert.deepEqual(classifyLink('https://gitlab.com/g/sub/repo/-/merge_requests/7', null), { kind: 'mr', label: 'repo !7' });
    assert.deepEqual(classifyLink('https://github.com/o/r/pull/42/files', null), { kind: 'mr', label: 'r #42' });
});

test('classify: Feishu / Lark documents', () => {
    assert.deepEqual(classifyLink('https://bytedance.larkoffice.com/docx/AbCdEf123', '需求 Spec'), { kind: 'doc', label: '需求 Spec' });
    assert.deepEqual(classifyLink('https://x.feishu.cn/wiki/QwErTy999', null), { kind: 'doc', label: 'Wiki QwErTy' });
    assert.equal(classifyLink('https://a.larksuite.com/sheets/S1', null).label, '表格 S1');
    assert.equal(classifyLink('https://feishu.cn/base/B1', null).label, '多维表格 B1');
    assert.equal(classifyLink('https://x.feishu-boe.cn/mindnotes/M1', null).label, '思维笔记 M1');
    assert.equal(classifyLink('https://x.feishu.cn/slides/P1', null).label, '幻灯片 P1');
    assert.equal(classifyLink('https://x.feishu.cn/docs/D1', null).label, '文档 D1');
    assert.equal(classifyLink('https://x.feishu.cn/drive/folder/F1', null).kind, 'other', 'not a document path');
    assert.equal(classifyLink('https://notfeishu.cn/docx/X', null).kind, 'other', 'suffix must match a whole label');
});

test('classify: other', () => {
    assert.deepEqual(classifyLink('https://www.npmjs.com/package/marked', null), { kind: 'other', label: 'www.npmjs.com/package/marked' });
    assert.deepEqual(classifyLink('https://a.com/x', '设计稿'), { kind: 'other', label: '设计稿' });
    assert.ok(classifyLink(`https://a.com/${'x'.repeat(200)}`, null).label.length <= 60);
});
