// Image attachments: prepare in the browser, seal, upload, announce with a
// file event; and fetch + open them again to show in the chat.
// Mirrors happy-ios HappyAPI+Attachments.swift / LegacySyncEngine.filePayload
// and happy-cli apiSession (request-download, decryptBlob).
import { blobKey, openBlob, sealBlob } from './crypto.js';

const CLAUDE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_EDGE = 2000;               // longer side after resizing
const MAX_BYTES = 3.5 * 1024 * 1024; // keeps base64 under Claude's 5 MB image limit

/**
 * A picked/pasted/dropped image, ready to upload:
 * { bytes, name, mimeType, width, height, previewUrl }.
 * Large or unusual images are re-encoded as JPEG; throws if the browser cannot decode it.
 */
export async function prepareImage(file) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error(`读不了「${file.name || '图片'}」，换成 PNG 或 JPEG 再试`);
    }
    const { width, height } = bitmap;
    const name = file.name || `image-${Date.now()}.png`;
    if (CLAUDE_TYPES.has(file.type) && file.size <= MAX_BYTES && Math.max(width, height) <= MAX_EDGE) {
        bitmap.close();
        const bytes = new Uint8Array(await file.arrayBuffer());
        return { bytes, name, mimeType: file.type, width, height, previewUrl: URL.createObjectURL(file) };
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // JPEG has no transparency
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    let quality = 0.85;
    let blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    while (blob && blob.size > MAX_BYTES && quality > 0.4) {
        quality -= 0.15;
        blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    }
    if (!blob) throw new Error('图片压缩失败');
    return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        name: name.replace(/\.[^.]+$/, '') + '.jpg',
        mimeType: 'image/jpeg',
        width: w,
        height: h,
        previewUrl: URL.createObjectURL(blob),
    };
}

/** Seal and upload one prepared image to the session; returns its ref. */
export async function uploadImage(api, s, image) {
    const sealed = sealBlob(image.bytes, await blobKey(s.dataKey));
    const upload = await api('POST', `/v1/sessions/${encodeURIComponent(s.id)}/attachments/request-upload`,
        { filename: image.name, size: sealed.length });
    let res;
    if (upload.method === 'POST') {
        // S3 presigned POST: policy fields first, the file last.
        const form = new FormData();
        for (const [k, v] of Object.entries(upload.formFields ?? {})) form.append(k, v);
        form.append('file', new Blob([sealed], { type: 'application/octet-stream' }), 'blob');
        res = await fetch(upload.uploadUrl, { method: 'POST', body: form });
    } else if (upload.method === 'PUT') {
        // A self-hosted server keeps the file itself and wants the token.
        res = await fetch(upload.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream', ...api.authHeaderFor(upload.uploadUrl) },
            body: sealed,
        });
    } else {
        throw new Error('服务器给了不认识的上传方式');
    }
    if (!res.ok) throw new Error(`上传失败（${res.status}）`);
    return upload.ref;
}

/** The plaintext file event sent before the text it belongs to. */
export function fileEvent(ref, image, id, time) {
    return {
        role: 'session',
        content: {
            type: 'session',
            data: {
                id, time, role: 'user',
                ev: { t: 'file', ref, name: image.name, size: image.bytes.length, mimeType: image.mimeType,
                    image: { width: image.width, height: image.height } },
            },
        },
    };
}

const cache = new Map(); // ref -> Promise<object URL | null>

/** Remember a just-uploaded image so showing it does not download it again. */
export function rememberImage(ref, previewUrl) {
    cache.set(ref, Promise.resolve(previewUrl));
}

/** Object URL of an attachment's decrypted bytes (cached per ref), or null. */
export function imageUrl(api, s, ref, mimeType) {
    if (!cache.has(ref)) {
        cache.set(ref, (async () => {
            const { downloadUrl } = await api('POST', `/v1/sessions/${encodeURIComponent(s.id)}/attachments/request-download`, { ref });
            const res = await fetch(downloadUrl, { headers: api.authHeaderFor(downloadUrl) });
            if (!res.ok) throw new Error(`下载失败（${res.status}）`);
            const bytes = openBlob(new Uint8Array(await res.arrayBuffer()), await blobKey(s.dataKey));
            if (!bytes) throw new Error('图片无法解密');
            return URL.createObjectURL(new Blob([bytes], { type: mimeType || 'image/png' }));
        })().catch((e) => { cache.delete(ref); console.error(e); return null; }));
    }
    return cache.get(ref);
}
