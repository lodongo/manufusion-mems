const MAX_BYTES = 3 * 1024 * 1024;

function toBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('Could not read the file.'));
        reader.readAsDataURL(blob);
    });
}

async function compressImage(file: File, maxSide: number, type: 'image/jpeg' | 'image/png'): Promise<Blob> {
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        return file;
    }
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), type, 0.85));
}

/** Validates, shrinks images for mobile data, and returns base64 content ready to upload. Logos keep PNG transparency. */
export async function prepareFile(file: File, imageOnly: boolean, options: { logo?: boolean } = {}): Promise<{ data: string; name: string }> {
    const isImage = file.type === 'image/jpeg' || file.type === 'image/png';
    const isPdf = file.type === 'application/pdf';
    if (imageOnly && !isImage) throw new Error('Please choose an image (JPEG or PNG).');
    if (!isImage && !isPdf) throw new Error('Use a PDF or a photo (JPEG or PNG).');
    let blob: Blob = file;
    if (isImage) {
        blob = options.logo ? await compressImage(file, 800, file.type === 'image/png' ? 'image/png' : 'image/jpeg') : await compressImage(file, 1600, 'image/jpeg');
    }
    const limit = options.logo ? 1024 * 1024 : MAX_BYTES;
    if (blob.size > limit) throw new Error(`The file is larger than ${options.logo ? '1 MB' : '3 MB'}. Please use a smaller file.`);
    return { data: await toBase64(blob), name: file.name.slice(0, 100) };
}

export function formatSize(bytes: number): string {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
