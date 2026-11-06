// Permission modes a session can run in, sent as `meta.permissionMode` with a
// message. The keys are what Happy CLI accepts per agent (1.2.6:
// VALID_PERMISSION_MODES for Claude, CODEX_REMOTE_PERMISSION_MODES for Codex,
// runGemini's list for Gemini). Happy Agent sessions have their own modes and get none.
import { isRig } from './models.js';

const MODES = {
    claude: [
        ['default', '默认', '需要时询问'],
        ['acceptEdits', '自动接受编辑', '改文件不再询问，其他照常'],
        ['plan', '计划模式', '先出计划，批准后再动手'],
        ['bypassPermissions', 'YOLO', '全部放行，不再询问'],
    ],
    codex: [
        ['auto', '自动', 'Codex 自己判断，需要时询问；可写工作区（CLI 的默认）'],
        ['default', '谨慎', '不受信任的命令都询问；可写工作区'],
        ['read-only', '只读', '不询问，只能读文件'],
        ['safe-yolo', '工作区放行', '不询问，只能写工作区'],
        ['yolo', 'YOLO', '全部放行，可以访问整台电脑'],
    ],
    gemini: [
        ['default', '默认', '需要时询问'],
        ['read-only', '只读', '只能读文件'],
        ['safe-yolo', '工作区放行', '工作区内不询问'],
        ['yolo', 'YOLO', '全部放行，不再询问'],
    ],
};

const toOptions = (rows) => (rows ?? []).map(([key, name, description]) => ({ key, name, description }));

/** [{ key, name, description }] for a session; none for Happy Agent or agents without modes. */
export function permissionOptions(meta) {
    if (isRig(meta)) return [];
    return toOptions(MODES[meta?.flavor || 'claude']);
}

/** The same list for an agent id (settings page). */
export const agentPermissionOptions = (agent) => toOptions(MODES[agent]);

/** Display name of a mode key for a session ('' when it has no such mode). */
export const permissionName = (meta, key) => permissionOptions(meta).find((o) => o.key === key)?.name ?? '';
