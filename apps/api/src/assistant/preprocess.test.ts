import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { prepareDocument, sniffMime } from './preprocess.js';

function pdfBytes(stream: string): Buffer {
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
    `4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefAt = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer);
}

describe('prepareDocument', () => {
  it('reconoce la extensión si el navegador no manda el tipo', () => {
    expect(sniffMime('ticket.JPG', 'application/octet-stream')).toBe('image/jpeg');
    expect(sniffMime('notas.txt', 'text/plain')).toBeNull();
  });

  it('reduce una imagen a JPEG', async () => {
    const png = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 240, g: 240, b: 240 } },
    })
      .png()
      .toBuffer();
    const doc = await prepareDocument('foto.png', 'image/png', png);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]?.mime).toBe('image/jpeg');
    expect(doc.pages[0]?.bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  it('saca texto e imagen de un PDF de una página', async () => {
    const stream = 'BT /F1 18 Tf 40 80 Td (Factura 1210) Tj ET';
    const doc = await prepareDocument('factura.pdf', 'application/pdf', pdfBytes(stream));
    expect(doc.pageCount).toBe(1);
    expect(doc.text.toLowerCase()).toContain('factura');
    expect(doc.warnings, doc.warnings.join(' | ')).toEqual([]);
    expect(doc.pages.length).toBeGreaterThan(0);
  });
});
