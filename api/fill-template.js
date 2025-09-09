// /api/fill-template.js
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST');
      return res.end('Use POST with JSON body.');
    }

    const data = await readJson(req);

    // 1) Load template
    const tmplPath = path.join(process.cwd(), 'public', 'CTRL_Observer_Assessment_Profile_template_V1.pdf');
    const templateBytes = await fs.readFile(tmplPath);
    const pdf = await PDFDocument.load(templateBytes);

    // 2) Fonts & colours
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const black = rgb(0, 0, 0);
    const grey = rgb(0.35, 0.35, 0.35);

    // 3) Page + flow helpers
    let page = pdf.getPage(0);
    const margin = 36; // 0.5 inch
    const lineGap = 4;
    const wrapWidth = page.getWidth() - margin * 2;
    let cursorY = page.getHeight() - margin;

    const H1 = 16, H2 = 12, P = 10;

    const addPage = () => {
      page = pdf.addPage([page.getWidth(), page.getHeight()]);
      cursorY = page.getHeight() - margin;
    };

    function move(lines = 1, size = P) {
      cursorY -= lines * (size + lineGap);
      if (cursorY < margin + 80) addPage();
    }

    function drawTextBlock(text, { size = P, color = black, bold = false } = {}) {
      const chunks = wrapText(text ?? '', wrapWidth, bold ? fontBold : font, size);
      chunks.forEach(line => {
        page.drawText(line, { x: margin, y: cursorY, size, font: bold ? fontBold : font, color });
        move(1, size);
      });
    }

    function heading(text, size, extraGap = 6) {
      page.drawText(text, { x: margin, y: cursorY, size, font: fontBold, color: black });
      move(1, size);
      cursorY -= extraGap;
    }

    // 4) ——— Content drawing ———
    heading('Perspective — V2 Results', H1);

    const genAt = data?.generatedAt ? `Generated: ${data.generatedAt}` : '';
    if (genAt) drawTextBlock(genAt, { size: 8, color: grey });

    // Dominant
    heading('Current state', H2);
    drawTextBlock(data?.headline?.state || '—', { bold: true });
    drawTextBlock(data?.narrative?.dominant || '');

    // Title band
    heading('Title band', H2);
    drawTextBlock(data?.headline?.titleBand || '—', { bold: true });
    drawTextBlock(data?.narrative?.titleBand || '');

    // Directional pulls
    heading('Directional pulls', H2);
    drawTextBlock(data?.narrative?.directionalIntro || '', { color: grey });
    drawTextBlock(data?.narrative?.directionalText || '');

    // Spider chart block
    heading('Spider profile', H2);
    const labels = data?.spider?.labels || [];
    const values = data?.spider?.values || [];
    const cx = margin + 140, cy = cursorY - 10 - 120; // reserve space
    drawRadar(page, cx, cy, 110, values, {
      spokes: 12,
      stroke: rgb(0.10, 0.35, 0.80),
      fill: rgb(0.10, 0.35, 0.80),
      opacity: 0.15
    }, font);
    // caption
    const shapeLabel = data?.spider?.shape?.label || '';
    const shapeText  = data?.spider?.shape?.text || '';
    page.drawText(shapeLabel, { x: margin + 270, y: cy + 80, size: 11, font: fontBold, color: black });
    drawParagraph(page, `${shapeText}`, {
      x: margin + 270, y: cy + 78, width: page.getWidth() - (margin + 270) - margin,
      font, size: 10, color: grey, lineGap
    });
    // advance the cursor past the chart area
    cursorY = cy - 130;

    // Sequence
    heading('Sequence', H2);
    if (data?.sequence?.neighbourVsLeap) drawTextBlock(data.sequence.neighbourVsLeap);
    if (data?.sequence?.positions)      drawTextBlock(String(data.sequence.positions), { color: grey });
    if (data?.sequence?.confidence)     drawTextBlock(String(data.sequence.confidence), { color: grey });

    // Themes
    heading('Themes', H2);
    const topThemes = Array.isArray(data?.themes) ? data.themes : [];
    if (topThemes.length === 0) {
      drawTextBlock('—');
    } else {
      topThemes.slice(0, 5).forEach(t => {
        drawTextBlock(`• ${t.tag} — ${String(t.score)}`, { size: 10 });
      });
    }

    // Tips
    heading('Tips', H2);
    (data?.tips || []).slice(0, 8).forEach(t => drawTextBlock(`• ${t}`));

    // Actions
    heading('Actions', H2);
    (data?.actions || []).slice(0, 8).forEach(a => drawTextBlock(`• ${a}`));

    // 5) Save
    const bytes = await pdf.save();
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', 'inline; filename="ctrl-observer-profile.pdf"');
    return res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    return res.end(`Error: ${e?.message || e}`);
  }
}

/* ---------------- helpers ---------------- */

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(raw);
}

function wrapText(text, maxWidth, font, size) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    const width = font.widthOfTextAtSize(test, size);
    if (width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawParagraph(page, text, { x, y, width, font, size = 10, color = rgb(0,0,0), lineGap = 4 }) {
  const lines = wrapText(text || '', width, font, size);
  let cursorY = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cursorY, size, font, color });
    cursorY -= (size + lineGap);
  }
}

function drawRadar(page, cx, cy, radius, values, { spokes = 12, stroke, fill, opacity }, font) {
  // Axes
  const greyAxis = rgb(0.75, 0.75, 0.75);
  for (let i = 0; i < spokes; i++) {
    const a = (Math.PI * 2 * i) / spokes - Math.PI / 2;
    const x = cx + radius * Math.cos(a);
    const y = cy + radius * Math.sin(a);
    page.drawLine({ start: { x: cx, y: cy }, end: { x, y }, color: greyAxis, thickness: 0.5 });
  }
  // Concentric rings
  for (let r = radius * 0.25; r <= radius; r += radius * 0.25) {
    page.drawCircle({ x: cx, y: cy, size: r, borderColor: greyAxis, borderWidth: 0.5, color: undefined });
  }
  // Polygon (expects values scaled ~0..0.2 or 0..1; we normalise to 0..1)
  const vals = Array.from({ length: spokes }, (_, i) => Number(values[i] || 0));
  const max = Math.max(0.0001, ...vals);
  const norm = vals.map(v => (max ? v / max : 0));
  const pts = norm.map((v, i) => {
    const a = (Math.PI * 2 * i) / spokes - Math.PI / 2;
    const r = v * radius;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

  // Fill
  for (let i = 1; i + 1 < pts.length; i++) {
    page.drawPolygon([pts[0], pts[i], pts[i + 1]], {
      color: fill,
      opacity: opacity ?? 0.2,
      borderColor: stroke,
      borderWidth: 0.8
    });
  }
  // Outline
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    page.drawLine({ start: a, end: b, color: stroke, thickness: 0.8 });
  }
}

