// Minimal, dependency-free .xlsx writer (Office Open XML, stored zip).
// Values are written as inline strings or numbers - never as formulas - so exported
// data cannot trigger spreadsheet formula injection.

const enc = new TextEncoder();
let CRC_TABLE: Uint32Array | null = null;

function crc32(buf: Uint8Array): number {
    if (!CRC_TABLE) {
        CRC_TABLE = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            CRC_TABLE[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Array<{ name: string; data: Uint8Array }>): Blob {
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const f of files) {
        const name = enc.encode(f.name);
        const crc = crc32(f.data);
        const size = f.data.length;
        const local = new Uint8Array(30 + name.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true);
        lv.setUint16(8, 0, true);
        lv.setUint16(10, 0, true);
        lv.setUint16(12, 0x21, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, size, true);
        lv.setUint32(22, size, true);
        lv.setUint16(26, name.length, true);
        lv.setUint16(28, 0, true);
        local.set(name, 30);
        const cen = new Uint8Array(46 + name.length);
        const cv = new DataView(cen.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0x21, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, size, true);
        cv.setUint32(24, size, true);
        cv.setUint16(28, name.length, true);
        cv.setUint32(42, offset, true);
        cen.set(name, 46);
        parts.push(local, f.data);
        central.push(cen);
        offset += local.length + size;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end] as unknown as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function esc(value: string): string {
    return value
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function colName(index: number): string {
    let n = index + 1;
    let s = '';
    while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

export type Cell = string | number | null | undefined;

function cellXml(ref: string, value: Cell, style = 0): string {
    const s = style ? ` s="${style}"` : '';
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
    const text = value === null || value === undefined ? '' : String(value).slice(0, 32000);
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

/** Builds an .xlsx workbook with one sheet. */
export function buildXlsx(sheetName: string, header: string[], rows: Cell[][]): Blob {
    const safeSheet = esc(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
    const widths = header.map((h, i) => Math.min(60, Math.max(10, h.length + 2, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))));
    const lines: string[] = [];
    lines.push(`<row r="1">${header.map((h, i) => cellXml(`${colName(i)}1`, h, 1)).join('')}</row>`);
    rows.forEach((r, ri) => {
        lines.push(`<row r="${ri + 2}">${header.map((_, ci) => cellXml(`${colName(ci)}${ri + 2}`, r[ci])).join('')}</row>`);
    });
    const lastRef = `${colName(Math.max(0, header.length - 1))}${rows.length + 1}`;
    const sheet =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
        `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
        `<sheetData>${lines.join('')}</sheetData>` +
        `<autoFilter ref="A1:${lastRef}"/>` +
        '</worksheet>';
    const files = [
        {
            name: '[Content_Types].xml',
            text:
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
                '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        },
        {
            name: '_rels/.rels',
            text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        },
        {
            name: 'xl/workbook.xml',
            text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${safeSheet}'!$A$1:$${colName(Math.max(0, header.length - 1))}$${rows.length + 1}</definedName></definedNames></workbook>`,
        },
        {
            name: 'xl/_rels/workbook.xml.rels',
            text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        },
        {
            name: 'xl/styles.xml',
            text:
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
                '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
                '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill></fills>' +
                '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
                '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
                '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
                '</styleSheet>',
        },
        { name: 'xl/worksheets/sheet1.xml', text: sheet },
    ];
    return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.text) })));
}

export function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    savedNotice(url, fileName, blob);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
}

/** Saves a file that arrived as a data URL (a document stored on the server). */
export function downloadDataUrl(dataUrl: string, fileName: string): void {
    const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
    if (!m) throw new Error('This file cannot be downloaded.');
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    downloadBlob(new Blob([bytes], { type: m[1] }), fileName);
}

/**
 * Phones and in-app browsers sometimes ignore a download without saying so. A short notice offers the other ways to
 * keep the file: open it in a new tab, or share it to Files, WhatsApp or email. It removes itself after 25 seconds.
 */
function savedNotice(url: string, fileName: string, blob: Blob): void {
    try {
        document.getElementById('mems-saved-notice')?.remove();
        const box = document.createElement('div');
        box.id = 'mems-saved-notice';
        box.setAttribute('role', 'status');
        box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:480px;margin:0 auto;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:14px;border:1px solid #334155;background:#0f172a;color:#f8fafc;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45)';
        const text = document.createElement('div');
        text.textContent = fileName + ' was sent to your downloads. If it was not saved on this device, use one of these.';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
        const style = 'min-height:44px;padding:0 14px;border-radius:10px;border:1px solid #475569;background:#1e293b;color:#f8fafc;font:inherit;display:inline-flex;align-items:center;justify-content:center;text-decoration:none';
        const open = document.createElement('a');
        open.href = url;
        open.target = '_blank';
        open.rel = 'noopener';
        open.textContent = 'Open';
        open.style.cssText = style;
        row.appendChild(open);
        const file = typeof File === 'function' ? new File([blob], fileName, { type: blob.type }) : null;
        const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
        if (file && typeof nav.share === 'function' && nav.canShare && nav.canShare({ files: [file] })) {
            const share = document.createElement('button');
            share.type = 'button';
            share.textContent = 'Share or save';
            share.style.cssText = style;
            share.onclick = () => {
                nav.share({ files: [file], title: fileName }).catch(() => undefined);
            };
            row.appendChild(share);
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.style.cssText = style;
        close.onclick = () => box.remove();
        row.appendChild(close);
        box.appendChild(text);
        box.appendChild(row);
        document.body.appendChild(box);
        setTimeout(() => box.remove(), 25000);
    } catch {
        // The download itself has already been attempted.
    }
}
