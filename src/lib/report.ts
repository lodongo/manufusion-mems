import { downloadBlob } from './xlsx';

// A printable PDF of a record (a purchase requirement, a quotation case). Built in the browser from the data the
// server already returned to this person; nothing is sent anywhere. jsPDF is loaded only when a PDF is asked for.

export interface ReportSection {
    heading: string;
    facts?: Array<[string, string]>;
    text?: string;
    table?: { head: string[]; body: string[][] };
}

export interface Report {
    title: string;
    subtitle?: string;
    fileName: string;
    /** Who printed it and when is added to every page. */
    printedBy?: string;
    sections: ReportSection[];
}

/** The built-in PDF fonts only cover Latin-1; anything else is replaced so the text never turns into garbage. */
const safe = (v: unknown) =>
    String(v ?? '')
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/…/g, '...')
        .replace(/[^\u0009\u000A -ÿ]/g, '?');

export async function downloadReportPdf(r: Report): Promise<void> {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    const margin = 14;
    let y = 18;

    const room = (need: number) => {
        if (y + need > height - 16) {
            doc.addPage();
            y = 16;
        }
    };

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(safe(r.title), margin, y);
    y += 6;
    if (r.subtitle) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const lines: string[] = doc.splitTextToSize(safe(r.subtitle), width - margin * 2);
        doc.text(lines, margin, y);
        y += lines.length * 4.5 + 2;
    }

    for (const s of r.sections) {
        room(14);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(30, 41, 59);
        doc.text(safe(s.heading), margin, y);
        y += 2;
        doc.setDrawColor(203, 213, 225);
        doc.line(margin, y, width - margin, y);
        y += 4;
        doc.setTextColor(0, 0, 0);
        if (s.facts && s.facts.length) {
            autoTable(doc, {
                startY: y,
                body: s.facts.map(([k, v]) => [safe(k), safe(v) || '-']),
                theme: 'plain',
                styles: { fontSize: 9, cellPadding: 1, overflow: 'linebreak', textColor: [15, 23, 42] },
                columnStyles: { 0: { cellWidth: 46, fontStyle: 'bold', textColor: [71, 85, 105] } },
                margin: { left: margin, right: margin },
            });
            y = (doc as any).lastAutoTable.finalY + 4;
        }
        if (s.text) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            const lines: string[] = doc.splitTextToSize(safe(s.text), width - margin * 2);
            for (const line of lines) {
                room(5);
                doc.text(line, margin, y);
                y += 4.2;
            }
            y += 2;
        }
        if (s.table && s.table.body.length) {
            autoTable(doc, {
                startY: y,
                head: [s.table.head.map(safe)],
                body: s.table.body.map((row) => row.map(safe)),
                styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak' },
                headStyles: { fillColor: [30, 41, 59], textColor: 255 },
                margin: { left: margin, right: margin },
            });
            y = (doc as any).lastAutoTable.finalY + 5;
        }
    }

    const pages = doc.getNumberOfPages();
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(safe(`${r.printedBy ? `Printed by ${r.printedBy} · ` : ''}${stamp} UTC · MEMS`), margin, height - 8);
        doc.text(`Page ${i} of ${pages}`, width - margin, height - 8, { align: 'right' });
    }
    downloadBlob(doc.output('blob'), `${r.fileName.replace(/[^A-Za-z0-9_-]+/g, '_')}.pdf`);
}
