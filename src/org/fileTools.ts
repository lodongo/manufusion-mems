import { callBackend } from '../lib/backend';
import { downloadDataUrl } from '../lib/xlsx';

// Reading a document chosen on the phone or computer, and opening one that is stored on the server.
// Only PDF, JPEG and PNG are accepted; the server checks the type and the file header again.

const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const BY_EXT: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const MAX_BYTES = 450 * 1024;
const MAX_CHARS = 600_000;

export interface Upload {
    name: string;
    type: string;
    data: string;
}

function dataUrl(blob: Blob, fileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error(`${fileName}: could not be read.`));
        reader.readAsDataURL(blob);
    });
}

// Phone photos are often several MB, so an image above the limit is scaled down here instead of being refused.
async function shrinkImage(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error(`${file.name}: the image could not be opened.`));
            el.src = url;
        });
        let scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        for (let attempt = 0; attempt < 6; attempt++) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
            const g = canvas.getContext('2d');
            if (!g) break;
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, canvas.width, canvas.height);
            g.drawImage(img, 0, 0, canvas.width, canvas.height);
            const out = canvas.toDataURL('image/jpeg', attempt < 3 ? 0.8 - attempt * 0.15 : 0.5);
            if (out.length <= MAX_CHARS) return out;
            scale *= 0.75;
        }
        throw new Error(`${file.name}: the image is too large even after reducing it. Take a closer photo of the document.`);
    } finally {
        URL.revokeObjectURL(url);
    }
}

export async function readUpload(file: File): Promise<Upload> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const type = OK_TYPES.includes(file.type) ? file.type : BY_EXT[ext] ?? '';
    if (!type) throw new Error(`${file.name}: only PDF, JPEG or PNG files are accepted.`);
    if (file.size <= MAX_BYTES) {
        const raw = await dataUrl(file, file.name);
        return { name: file.name, type, data: `data:${type};base64,${raw.slice(raw.indexOf(',') + 1)}` };
    }
    if (type === 'application/pdf') throw new Error(`${file.name}: this PDF is ${Math.round(file.size / 1024)} KB and the limit is 450 KB. Compress it, or take a photo of the document instead.`);
    return { name: `${file.name.replace(/\.[^.]+$/, '')}.jpg`, type: 'image/jpeg', data: await shrinkImage(file) };
}

/** Fetch a stored document from the server (the access is checked and audited there) and save it. */
export async function openStored(path: string, body: Record<string, unknown>) {
    const f = await callBackend<{ name: string; type: string; data: string }>(path, body);
    downloadDataUrl(f.data, f.name);
}
