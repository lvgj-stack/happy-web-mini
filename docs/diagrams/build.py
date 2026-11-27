"""Generate the README diagrams (HTML source; PNGs are exported from these). Run: python3 docs/diagrams/build.py"""
import math, sys, unicodedata
from pathlib import Path

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent
OUT.mkdir(parents=True, exist_ok=True)

PAPER = '#F2F3EF'; INK = '#262A27'; MUTED = '#5B625C'; SOFT = '#626963'
ACCENT = '#4A6650'; TINT = '#E8EEE6'; WHITE = '#FFFFFF'
SANS = "'Geist', 'PingFang SC', 'Noto Sans SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
MONO = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace"
SERIF = "'Instrument Serif', 'Noto Serif SC', 'Songti SC', serif"
FONTS = ('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600'
         '&family=Geist+Mono:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600&family=Noto+Serif+SC:wght@400&display=swap')


def wide(ch): return unicodedata.east_asian_width(ch) in 'WF'
def has_wide(s): return any(wide(c) for c in s)
def tw(s, size, mono=False):
    return sum(0 if unicodedata.combining(c) else size if wide(c) else size * (0.62 if mono else 0.6) for c in s)
def r4(x): return int(math.ceil(x / 4) * 4)
def esc(s): return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


class D:
    def __init__(self, slug, w, h):
        self.slug, self.w, self.h = slug, w, h
        self.zones, self.arrows, self.labels, self.nodes, self.notes = [], [], [], [], []

    # ---- zones -------------------------------------------------------
    def zone(self, x, y, w, h, label):
        lw = r4(tw(label, 12) + 12)
        self.zones.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="rgba(38,42,39,0.02)" stroke="rgba(38,42,39,0.16)" stroke-width="0.8"/>'
            f'<rect x="{x + 12}" y="{y + 4}" width="{lw}" height="16" rx="2" fill="{PAPER}"/>'
            f'<text x="{x + 12 + lw / 2}" y="{y + 16.5}" fill="{SOFT}" font-size="12" font-weight="500" font-family="{SANS}" text-anchor="middle">{esc(label)}</text>')

    # ---- connectors --------------------------------------------------
    def path(self, d, accent=False, dashed=False, both=False, head=True):
        color = ACCENT if accent else MUTED
        mk = 'arrow-accent' if accent else 'arrow'
        extra = ' stroke-dasharray="5,4"' if dashed else ''
        ends = (f' marker-end="url(#{mk})"' if head else '') + (f' marker-start="url(#{mk})"' if both else '')
        self.arrows.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.2"{extra}{ends}/>')

    def line(self, d):  # tree bus, no marker
        self.arrows.append(f'<path d="{d}" fill="none" stroke="{MUTED}" stroke-width="1"/>')

    def _label(self, x, y, text):
        """Mask with top-left (x, y); returns nothing. Chinese → 12px sans, Latin → 8px mono caps."""
        if has_wide(text):
            w, h = r4(tw(text, 12) + 8), 16
            t = (f'<text x="{x + w / 2}" y="{y + 12.5}" fill="{SOFT}" font-size="12" font-weight="500" '
                 f'font-family="{SANS}" text-anchor="middle">{esc(text)}</text>')
        else:
            text = text.upper()
            w, h = r4(tw(text, 8, True) + 0.48 * len(text) + 8), 12
            t = (f'<text x="{x + w / 2}" y="{y + 9}" fill="{SOFT}" font-size="8" font-family="{MONO}" '
                 f'text-anchor="middle" letter-spacing="0.06em">{esc(text)}</text>')
        self.labels.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" fill="{PAPER}"/>{t}')

    def size(self, text):
        if has_wide(text): return r4(tw(text, 12) + 8), 16
        text = text.upper(); return r4(tw(text, 8, True) + 0.48 * len(text) + 8), 12

    def above(self, cx, ly, text, gap=6):
        w, h = self.size(text); self._label(cx - w / 2, ly - gap - h, text)
    def below(self, cx, ly, text, gap=6):
        w, h = self.size(text); self._label(cx - w / 2, ly + gap, text)
    def right(self, lx, cy, text, gap=8):
        w, h = self.size(text); self._label(lx + gap, cy - h / 2, text)
    def left(self, lx, cy, text, gap=8):
        w, h = self.size(text); self._label(lx - gap - w, cy - h / 2, text)

    # ---- nodes -------------------------------------------------------
    def node(self, x, y, w, h, name, subs=(), focal=False, oval=False, rx=6, tag=None):
        fill, stroke = (TINT, ACCENT) if focal else (WHITE, INK)
        r = h / 2 if oval else rx
        cx, cy = x + w / 2, y + h / 2
        s = (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{PAPER}"/>'
             f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{1.2 if focal else 1}"/>')
        if tag:
            tw_ = r4(tw(tag, 7, True) + 0.56 * len(tag) + 8)
            s += (f'<rect x="{x + 8}" y="{y + 6}" width="{tw_}" height="12" rx="2" fill="none" stroke="{stroke}" stroke-opacity="0.4" stroke-width="0.8"/>'
                  f'<text x="{x + 8 + tw_ / 2}" y="{y + 15}" fill="{stroke}" fill-opacity="0.85" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.08em">{esc(tag)}</text>')
        # vertical rhythm: name 12px, mono sub 14px line, Chinese sub 16px line
        lines = [('name', name)] + list(subs)
        heights = [16 if k in ('name', 'zh') else 13 for k, _ in lines]
        top = cy - sum(heights) / 2
        for (k, t), lh in zip(lines, heights):
            base = top + (12.5 if k != 'mono' else 9.5)
            if k == 'name':
                s += f'<text x="{cx}" y="{base}" fill="{INK}" font-size="12" font-weight="600" font-family="{SANS}" text-anchor="middle">{esc(t)}</text>'
            elif k == 'mono':
                s += f'<text x="{cx}" y="{base}" fill="{MUTED}" font-size="9" font-family="{MONO}" text-anchor="middle">{esc(t)}</text>'
            else:
                s += f'<text x="{cx}" y="{base}" fill="{MUTED}" font-size="12" font-family="{SANS}" text-anchor="middle">{esc(t)}</text>'
            top += lh
        self.nodes.append(s)

    def diamond(self, cx, cy, hw, hh, name):
        pts = f'{cx},{cy - hh} {cx + hw},{cy} {cx},{cy + hh} {cx - hw},{cy}'
        self.nodes.append(
            f'<polygon points="{pts}" fill="{PAPER}"/>'
            f'<polygon points="{pts}" fill="{WHITE}" stroke="{INK}" stroke-width="1"/>'
            f'<text x="{cx}" y="{cy + 4.5}" fill="{INK}" font-size="12" font-weight="600" font-family="{SANS}" text-anchor="middle">{esc(name)}</text>')

    def dot(self, cx, cy, r=6):
        self.nodes.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{INK}"/>')

    def note(self, x, y, lines, anchor='start'):
        for i, t in enumerate(lines):
            self.notes.append(f'<text x="{x}" y="{y + i * 20}" fill="{MUTED}" font-size="14" font-style="italic" '
                              f'font-family="{SERIF}" text-anchor="{anchor}">{esc(t)}</text>')

    # ---- output ------------------------------------------------------
    def html(self, eyebrow, title, desc):
        s = self.slug
        svg = (f'<svg viewBox="0 0 {self.w} {self.h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{s}-title {s}-desc">\n'
               f'<title id="{s}-title">{esc(title)}</title>\n<desc id="{s}-desc">{esc(desc)}</desc>\n<defs>\n'
               f'<marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto-start-reverse"><polygon points="0 0, 8 3, 0 6" fill="{MUTED}"/></marker>\n'
               f'<marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto-start-reverse"><polygon points="0 0, 8 3, 0 6" fill="{ACCENT}"/></marker>\n'
               f'</defs>\n<rect width="100%" height="100%" fill="{PAPER}"/>\n'
               + '\n'.join(self.zones + self.arrows + self.labels + self.nodes + self.notes) + '\n</svg>')
        return f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{esc(title)}</title>
  <link href="{FONTS}" rel="stylesheet">
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: {SANS}; background: {PAPER}; color: {INK}; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; padding: 3rem 2rem; }}
    .frame {{ max-width: 1200px; width: 100%; }}
    .diagram-container {{ width: 100%; overflow-x: auto; }}
    .eyebrow {{ font-size: 0.8rem; font-weight: 500; color: {MUTED}; margin-bottom: 0.5rem; }}
    h1 {{ font-family: {SERIF}; font-size: clamp(1.5rem, 2.4vw + 0.75rem, 2rem); font-weight: 400;
         letter-spacing: -0.02em; line-height: 1.15; margin-bottom: 1.5rem; }}
    svg {{ width: 100%; min-width: {self.w}px; display: block; }}
    @media print {{ .diagram-container {{ overflow-x: visible; }} svg {{ min-width: 0; }} }}
  </style>
</head>
<body>
  <div class="frame">
    <p class="eyebrow">{esc(eyebrow)}</p>
    <h1>{esc(title)}</h1>
    <div class="diagram-container">
{svg}
    </div>
  </div>
</body>
</html>
'''

    def save(self, *a):
        (OUT / f'{self.slug}.html').write_text(self.html(*a))


# ===================================================================
# 1. How it works — architecture
# ===================================================================
d = D('how-it-works', 960, 416)
d.zone(40, 48, 248, 328, '你的电脑')
d.zone(672, 48, 248, 240, '你看的地方')
# CLI wraps the agent; daemon starts CLI
d.path('M164,200 V144'); d.right(164, 172, '包装运行')
d.path('M164,296 V256'); d.right(164, 276, '按需启动')
d.path('M264,228 H380', both=True); d.above(322, 228, '加密消息')
d.path('M264,324 H412 Q420,324 420,316 V272', both=True); d.above(338, 324, '机器 RPC')
d.path('M580,228 H696', both=True); d.above(638, 228, 'Socket.IO')
d.path('M540,184 V124 Q540,116 548,116 H696', both=True)
d.path('M796,144 V192', dashed=True); d.right(796, 168, '扫码登录')
d.node(64, 88, 200, 56, 'Claude Code 等 agent', [('mono', 'codex · cursor · gemini')])
d.node(64, 200, 200, 56, 'Happy CLI', [('mono', 'happy claude / happy codex')])
d.node(64, 296, 200, 56, 'Happy daemon', [('zh', '新建 · 恢复 · Fork 会话')])
d.node(380, 184, 200, 88, 'Happy server', [('mono', 'api.cluster-fluster.com'), ('zh', '只存密文，转发消息和 RPC')])
d.node(696, 88, 200, 56, 'Happy App', [('zh', '手机 · iOS / Android')])
d.node(696, 192, 200, 72, 'happy-web-mini', [('zh', '浏览器 · Mac 应用'), ('zh', '在本地解密')], focal=True)
d.note(436, 308, ['server 只转发密文，', '账户主密钥只在手机和这里。'])
d.save('架构 · 工作原理', '消息怎么到你眼前',
       'Happy CLI 和 daemon 在你的电脑上跑 agent，经 Happy server 把加密消息转给手机 App 和 happy-web-mini，后者在本地解密。')

# ===================================================================
# 2. Session list grouping — tree
# ===================================================================
d = D('session-tree', 960, 432)
d.line('M480,92 V116'); d.line('M160,116 H680')
for x in (160, 400, 680): d.line(f'M{x},116 V140')
d.line('M680,192 V216'); d.line('M560,216 H800')
for x in (560, 800): d.line(f'M{x},216 V240')
d.line('M800,292 V340')
d.node(400, 40, 160, 52, '一台电脑', [('zh', '可以拖动排先后')])
d.node(80, 140, 160, 52, 'Bot', [('zh', 'Happy Agent 的 bot')])
d.node(320, 140, 160, 52, '任务', [('mono', '~/Tasks/…')])
d.node(600, 140, 160, 52, '项目目录', [('mono', '~/code/app')])
d.node(480, 240, 160, 52, '会话', [('zh', '直接在目录里跑')])
d.node(720, 240, 160, 52, 'worktree', [('mono', '.dev/worktree/*')], focal=True)
d.node(720, 340, 160, 52, '会话', [('zh', '在 worktree 里跑')])
d.note(80, 268, ['Bot 和任务各自成组，', '其余会话按目录排成树。'])
d.note(696, 362, ['worktree 不单独成组，', '归到所属仓库下面。'], anchor='end')
d.save('树 · 会话列表', '会话列表怎么分组',
       '会话列表按电脑分组，每台电脑下分 Bot、任务和项目目录，项目目录下再分直接在目录里跑的会话和各个 worktree 里的会话。')

# ===================================================================
# 3. Session lifecycle — state machine
# ===================================================================
d = D('session-lifecycle', 960, 400)
d.zone(112, 72, 536, 280, '在线：列表里显示的会话')
d.path('M70,148 H160'); d.above(115, 148, '新建 · Fork')
d.path('M208,176 V264'); d.left(208, 220, '要批准或提问')
d.path('M272,264 V176'); d.right(272, 236, '允许 · 回答')
d.path('M320,148 H440'); d.above(380, 148, '一轮结束')
d.path('M520,176 V264'); d.right(520, 220, '打开看了')
d.path('M440,300 H388 Q380,300 380,292 V172 Q380,164 372,164 H320'); d.right(380, 228, '发消息')
d.path('M648,148 H736'); d.above(692, 148, 'CLI 退出')
d.path('M736,164 H648'); d.below(692, 164, '恢复')
d.path('M648,284 H736'); d.above(692, 284, '归档')
d.path('M736,300 H648'); d.below(692, 300, '恢复')
d.path('M816,176 V264'); d.right(816, 220, '归档 · 只改标记')
d.path('M816,320 V348'); d.right(816, 336, '永久删除')
d.dot(64, 148)
d.node(160, 120, 160, 56, '工作中', [('zh', '转圈')], rx=8)
d.node(160, 264, 160, 56, '等你处理', [('zh', '琥珀色 · 算进角标')], rx=8, focal=True)
d.node(440, 120, 160, 56, '完成未读', [('zh', '绿点 · 算进角标')], rx=8)
d.node(440, 264, 160, 56, '已读', [('zh', '空闲')], rx=8)
d.node(736, 120, 160, 56, '离线', [('zh', '不在列表里')], rx=8)
d.node(736, 264, 160, 56, '已归档', [('zh', '列表最下面的分组')], rx=8)
d.nodes.append(f'<circle cx="816" cy="356" r="8" fill="{PAPER}" stroke="{INK}" stroke-width="1.2"/><circle cx="816" cy="356" r="5" fill="{INK}"/>')
d.save('状态机 · 会话', '一个会话的生命周期',
       '会话新建后在工作中、等你处理、完成未读和已读之间流转；CLI 退出后变成离线，归档后进入已归档，两者都可以恢复回到在线，已归档的会话还可以永久删除。')

# ===================================================================
# 4. Resume with a deleted worktree — flowchart
# ===================================================================
d = D('resume-worktree', 960, 696)
d.path('M480,72 V104')
d.path('M480,152 V176')
d.path('M560,216 H660', accent=True); d.above(610, 216, '是')
d.path('M480,256 V280'); d.right(480, 268, '否')
d.path('M400,320 H300'); d.above(350, 320, '否')
d.path('M480,360 V384'); d.right(480, 372, '是')
d.path('M400,424 H288 Q280,424 280,432 V488'); d.above(344, 424, '是')
d.path('M560,424 H672 Q680,424 680,432 V488'); d.above(616, 424, '否')
d.path('M280,544 V568 Q280,576 288,576 H432 Q440,576 440,584 V600')
d.path('M680,544 V568 Q680,576 672,576 H528 Q520,576 520,584 V600')
d.path('M580,628 H892 Q900,628 900,620 V136 Q900,128 892,128 H580'); d.left(900, 400, '再恢复一次')
d.node(380, 32, 200, 40, '点「恢复会话」', oval=True)
d.node(380, 104, 200, 48, 'daemon 在原目录恢复', [('mono', 'resume-happy-session')])
d.diamond(480, 216, 80, 40, '目录还在？')
d.node(660, 196, 200, 40, '接着原来的对话跑', oval=True, focal=True)
d.diamond(480, 320, 80, 40, '是 worktree 吗？')
d.node(100, 300, 200, 40, '提示：目录已经不在了', oval=True)
d.diamond(480, 424, 80, 40, '分支还在？')
d.node(180, 488, 200, 56, '检出原分支', [('mono', 'git worktree add')])
d.node(580, 488, 200, 56, '从主目录新建同名分支', [('zh', '没提交的改动找不回')])
d.node(380, 600, 200, 56, '在原路径重建 worktree', [('mono', '.dev/worktree/<name>')])
d.note(100, 628, ['Fork 遇到同样的情况，', '也先重建再启动。'])
d.save('流程图 · 恢复会话', '恢复时重建已删除的 worktree',
       '恢复会话时如果目录已删且是 worktree，先按分支是否还在检出原分支或新建同名分支，在原路径重建后再恢复一次。')
print('ok')
