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
    const pdfDoc = await PDFDocument.load(tplBytes);
    const page = pdfDoc.getPage(0);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // ------------- Normalise inputs (simple params OR base64 JSON) -------------
    let dominant   = q.dominant;
    let titleBand  = q.titleBand;
    let pullText   = q.pullText;
    let reportDate = q.reportDate;
    let fileName   = q.name || 'CTRL_Profile.pdf';
    let fullName   = q.fullName || '';

    let payload = q.data;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')); } catch {}
      if (!payload) { try { payload = JSON.parse(q.data); } catch {} }
    }
    if (payload && typeof payload === 'object') {
      dominant   ||= payload.dom6Label || payload.dominant;
      titleBand  ||= payload.how6      || payload.titleBand;
      pullText   ||= payload.pullText  || payload.page7Blocks?.[0]?.body || payload.dirPullText;
      reportDate ||= payload.dateLbl || payload.reportDate;
      fullName   ||= payload.person?.fullName || '';
      fileName   ||= payload.name || fileName;
    }

    dominant   = (dominant   || '—').toString();
    titleBand  = (titleBand  || '—').toString();
    pullText   = (pullText   || '—').toString();
    reportDate = (reportDate || '').toString();
    fullName   = (fullName   || '').toString();

    // --------------------------- Debug grid (optional) --------------------------
    if (q.debug === 'grid') {
      const w = page.getWidth(), h = page.getHeight();
      for (let x = 0; x <= w; x += 50)
        page.drawLine({ start: { x, y: 0 }, end: { x, y: h }, color: rgb(0.85,0.85,0.95), thickness: 0.5 });
      for (let y = 0; y <= h; y += 50)
        page.drawLine({ start: { x: 0, y }, end: { x: w, y }, color: rgb(0.85,0.85,0.95), thickness: 0.5 });
    }

    // --------------------- Coordinates (tweakable via query) --------------------
    // Defaults below are a sensible start; override from the URL while you line up.
    const num = (v, d) => (v == null ? d : +v);

    const FIELDS = {
      // put the three cover values inside the dial area (adjust to taste)
      dominant:  { x: num(q.domX, 178), y: num(q.domY, 310), size: num(q.domSize, 12), color: rgb(0.12,0.07,0.33) },
      titleBand: { x: num(q.bandX,178), y: num(q.bandY,292), size: num(q.bandSize,12), color: rgb(0.12,0.07,0.33) },
      pullText:  { x: num(q.pullX,178), y: num(q.pullY,260), size: num(q.pullSize,11), color: rgb(0.12,0.07,0.33),
                   maxWidth: num(q.pullW,240), lineHeight: num(q.pullLH,13), maxLines: num(q.pullMax,3) },

      // next to the “Name:” and “Date:” labels
      name:      { x: num(q.nameX,140), y: num(q.nameY,130), size: num(q.nameSize,18), color: rgb(0,0,0) },
      date:      { x: num(q.dateX,140), y: num(q.dateY, 82), size: num(q.dateSize,18), color: rgb(0,0,0) },

      // (rarely needed) a tiny file name at the top-left; off by default
      fileName:  { x: num(q.fnX, 70),  y: num(q.fnY, 385), size: 10, color: rgb(0,0,0) }
    };

    const SHOW_FILE_NAME = q.showFileName === '1';

    // ----------------------------- text helpers --------------------------------
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

    // ------------------------------- DRAW --------------------------------------
    if (SHOW_FILE_NAME) {
      page.drawText(fileName, { x: FIELDS.fileName.x, y: FIELDS.fileName.y, size: FIELDS.fileName.size, font, color: FIELDS.fileName.color });
    }

    page.drawText(dominant,  { x: FIELDS.dominant.x,  y: FIELDS.dominant.y,  size: FIELDS.dominant.size,  font, color: FIELDS.dominant.color });
    page.drawText(titleBand, { x: FIELDS.titleBand.x, y: FIELDS.titleBand.y, size: FIELDS.titleBand.size, font, color: FIELDS.titleBand.color });

    const lines = wrap(pullText, FIELDS.pullText.maxWidth, FIELDS.pullText.size)
      .slice(0, FIELDS.pullText.maxLines);
    let y = FIELDS.pullText.y;
    for (const ln of lines) {
      page.drawText(ln, { x: FIELDS.pullText.x, y, size: FIELDS.pullText.size, font, color: FIELDS.pullText.color });
      y -= FIELDS.pullText.lineHeight;
    }

    if (fullName)   page.drawText(fullName,   { x: FIELDS.name.x, y: FIELDS.name.y, size: FIELDS.name.size, font, color: FIELDS.name.color });
    if (reportDate) page.drawText(reportDate, { x: FIELDS.date.x, y: FIELDS.date.y, size: FIELDS.date.size, font, color: FIELDS.date.color });

    // ------------------------------- OUTPUT ------------------------------------
    const out = await pdfDoc.save();
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${String(fileName).replace(/"/g,'')}"`);
    res.end(Buffer.from(out));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok:false, error: err?.message || String(err) }));
  }
}
