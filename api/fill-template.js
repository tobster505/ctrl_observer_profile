// /api/fill-template.js
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';

export default async function handler(req, res) {
  try {
    const isGET = (req.method || 'GET').toUpperCase() === 'GET';
    const q = isGET ? (req.query || {}) : (req.body || {});

    const tpl = q.tpl || 'CTRL_Observer_Assessment_Profile_template_V1.pdf';
    const pdfPath = path.join(process.cwd(), 'public', tpl);
    const tplBytes = await fs.readFile(pdfPath);

    // ---- Normalise inputs (simple params OR base64 JSON in ?data / body.data) ----
    let dominant   = q.dominant;
    let titleBand  = q.titleBand;
    let pullText   = q.pullText;
    let reportDate = q.reportDate;
    let fileName   = q.name || 'CTRL_Profile.pdf';
    let fullName   = q.fullName || '';

    let payload = q.data;
    if (typeof payload === 'string') {
      // try base64-then-JSON, then plain JSON
      try { payload = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')); } catch {}
      if (!payload) { try { payload = JSON.parse(q.data); } catch {} }
    }

    if (payload && typeof payload === 'object') {
      dominant   ||= payload.dom6Label || payload.dominant;
      titleBand  ||= payload.how6      || payload.titleBand;
      pullText   ||= payload.pullText  || payload.page7Blocks?.[0]?.body || payload.dirPullText;
      reportDate ||= payload.dateLbl || payload.reportDate;
      fullName   ||= payload.person?.fullName || '';
      fileName   ||= payload.name || `CTRL_${(fullName||'User').replace(/\s+/g,'')}_${(reportDate||'').replace(/\//g,'')}.pdf`;
    }

    // fallback defaults so the page never shows blanks
    dominant   = (dominant   || '—').toString();
    titleBand  = (titleBand  || '—').toString();
    pullText   = (pullText   || '—').toString();
    reportDate = (reportDate || '').toString();

    // ---- Load and draw ----
    const pdfDoc = await PDFDocument.load(tplBytes);
    const page = pdfDoc.getPage(0);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Optional grid to help place text: add &debug=grid
    if (q.debug === 'grid') {
      const w = page.getWidth(), h = page.getHeight();
      for (let x = 0; x <= w; x += 50)
        page.drawLine({ start: { x, y: 0 }, end: { x, y: h }, color: rgb(0.85, 0.85, 0.95), thickness: 0.5 });
      for (let y = 0; y <= h; y += 50)
        page.drawLine({ start: { x: 0, y }, end: { x: w, y }, color: rgb(0.85, 0.85, 0.95), thickness: 0.5 });
    }

    // ---- Coordinates (tweak to fit your template) ----
    const FIELDS = {
      fileName:  { x: 70,  y: 385, size: 10, color: rgb(0,0,0) },
      dominant:  { x: 88,  y: 310, size: 12, color: rgb(0.12,0.07,0.33) },
      titleBand: { x: 88,  y: 290, size: 12, color: rgb(0.12,0.07,0.33) },
      pullText:  { x: 88,  y: 255, size: 11, color: rgb(0.12,0.07,0.33), maxWidth: 230, lineHeight: 13, maxLines: 3 }
    };

    // helper: wrap text within a maxWidth using the embedded font width
    function wrap(text, maxWidth, size) {
      if (!maxWidth) return [text];
      const words = String(text).split(/\s+/);
      let lines = [], line = '';
      for (const w of words) {
        const candidate = line ? `${line} ${w}` : w;
        const width = font.widthOfTextAtSize(candidate, size);
        if (width > maxWidth && line) { lines.push(line); line = w; }
        else { line = candidate; }
      }
      if (line) lines.push(line);
      return lines;
    }

    // draw file name (top-left, small)
    page.drawText(fileName, {
      x: FIELDS.fileName.x, y: FIELDS.fileName.y, size: FIELDS.fileName.size, font, color: FIELDS.fileName.color
    });

    // draw dominant & title band
    page.drawText(dominant, {
      x: FIELDS.dominant.x, y: FIELDS.dominant.y, size: FIELDS.dominant.size, font, color: FIELDS.dominant.color
    });
    page.drawText(titleBand, {
      x: FIELDS.titleBand.x, y: FIELDS.titleBand.y, size: FIELDS.titleBand.size, font, color: FIELDS.titleBand.color
    });

    // draw directional pull (wrapped)
    const lines = wrap(pullText, FIELDS.pullText.maxWidth, FIELDS.pullText.size)
      .slice(0, FIELDS.pullText.maxLines);
    let y = FIELDS.pullText.y;
    for (const ln of lines) {
      page.drawText(ln, {
        x: FIELDS.pullText.x, y, size: FIELDS.pullText.size, font, color: FIELDS.pullText.color
      });
      y -= FIELDS.pullText.lineHeight;
    }

    const out = await pdfDoc.save();
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${fileName.replace(/"/g,'')}"`);
    res.end(Buffer.from(out));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  }
}
