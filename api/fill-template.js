// /api/fill-template.js
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';

export default async function handler(req, res) {
  try {
    const method = (req.method || 'GET').toUpperCase();
    const q = method === 'GET' ? (req.query || {}) : (req.body || {});

    // ---- Load template ----
    const tpl = q.tpl || 'CTRL_Observer_Assessment_Profile_template_V1.pdf';
    const pdfPath = path.join(process.cwd(), 'public', tpl);
    const tplBytes = await fs.readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(tplBytes);

    // ---- Fonts ----
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // ---- Normalise inbound data (query OR base64 "data") ----
    let payload = q.data;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')); } catch {}
      if (!payload) { try { payload = JSON.parse(q.data); } catch {} }
    }
    const get = (...xs) => xs.find(v => typeof v === 'string' && v.trim())?.trim();

    const pathName   = get(q.pathName, payload?.pathName, 'Observer');
    const fullName   = get(q.fullName, payload?.person?.fullName, payload?.fullName, '');
    const reportDate = get(q.reportDate, payload?.dateLbl, '');

    const dominantLabel   = get(q.dominant,   payload?.dom6Label, '');
    const characterLabel  = get(q.character,  payload?.characterLabel, ''); // e.g., Fal / Mika name
    const titleBandLabel  = get(q.titleBand,  payload?.how6, '');
    const titleBandText   = get(q.titleBandText, payload?.titleBandText, payload?.page9?.titleBandText, '');

    // Spider chart (page 10): 12 values in order [C_low, C_mid, C_high, T_low, T_mid, T_high, R_low, R_mid, R_high, L_low, L_mid, L_high]
    // Values expected 0..1 (normalised). If you send midpoints (1.25..4.75), we will auto-normalise.
    let spider = q.spider || payload?.spiderData;
    if (typeof spider === 'string') { try { spider = JSON.parse(spider); } catch {} }
    let spiderVals = Array.isArray(spider) ? spider.map(Number) : [];
    if (spiderVals.length !== 12) spiderVals = new Array(12).fill(0);

    // Auto-normalise if values look like band midpoints
    // map: [1.0..1.99]→C, [2.0..2.99]→T, [3.0..3.99]→R, [4.0..4.99]→L
    function normalise12(vals){
      return vals.map(v=>{
        if (!isFinite(v)) return 0;
        if (v<=1.99) return (v-1.00)/0.99;             // C  -> [0..1]
        if (v<=2.99) return (v-2.00)/0.99;             // T
        if (v<=3.99) return (v-3.00)/0.99;             // R
        return Math.min(1, Math.max(0,(v-4.00)/0.99)); // L
      }).map(x=>Math.max(0, Math.min(1, x)));
    }
    // If any entry >1.0 we assume midpoints and normalise
    if (spiderVals.some(v => v > 1)) spiderVals = normalise12(spiderVals);

    const spiderExpl   = get(q.spiderExpl, payload?.spiderExpl, payload?.page10?.spiderExpl, '');
    const patternExpl  = get(q.patternExpl, payload?.patternExpl, payload?.page11?.patternExpl, '');
    const themeExpl    = get(q.themeExpl, payload?.themeExpl, payload?.page11?.themeExpl, '');

    const tips   = Array.isArray(q.tips)   ? q.tips
                 : Array.isArray(payload?.tips) ? payload.tips
                 : Array.isArray(payload?.page12?.tips) ? payload.page12.tips : [];
    const actions= Array.isArray(q.actions)? q.actions
                 : Array.isArray(payload?.actions) ? payload.actions
                 : Array.isArray(payload?.page12?.actions) ? payload.page12.actions : [];

    const outName = get(q.name, payload?.name, `CTRL_${(fullName||'User').replace(/\s+/g,'')}_${(reportDate||'')}.pdf`);

    // ---- Utilities ----
    function ensurePages(n){
      const count = pdfDoc.getPageCount();
      if (count >= n) return;
      const refPage = pdfDoc.getPage(0);
      const w = refPage.getWidth(), h = refPage.getHeight();
      for (let i=count; i<n; i++) pdfDoc.addPage([w,h]);
    }
    ensurePages(12);

    const pages = [...Array(12)].map((_,i)=>pdfDoc.getPage(i));
    const clr = {
      ink: rgb(0.12,0.07,0.33),
      txt: rgb(0,0,0),
      faint: rgb(0.7,0.7,0.78),
      accent: rgb(0.36,0.22,0.82)
    };

    function drawText(page, txt, x, y, size=12, font=helv, color=clr.txt, opts={}) {
      page.drawText(String(txt||''), { x, y, size, font, color, ...opts });
    }
    function wrapLines(text, font, size, maxWidth){
      if (!text || !maxWidth) return [text||''];
      const words = String(text).split(/\s+/);
      const lines = [];
      let line = '';
      for (const w of words){
        const cand = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(cand, size) > maxWidth && line){
          lines.push(line); line = w;
        } else line = cand;
      }
      if (line) lines.push(line);
      return lines;
    }
    function drawPara(page, text, x, y, size, lineH, maxW, font=helv, color=clr.txt, maxLines=999){
      const lines = wrapLines(text, font, size, maxW).slice(0, maxLines);
      let yy = y;
      for (const ln of lines){
        drawText(page, ln, x, yy, size, font, color);
        yy -= lineH;
      }
      return yy;
    }
    function drawHeader(p, withDate=false){
      // Top-left header (consistent across pages)
      drawText(p, `Path: ${pathName || 'Observer'}`, 60, 760, 11, helvB, clr.ink);
      drawText(p, `Name: ${fullName || '—'}`,        60, 742, 11, helv,  clr.txt);
      if (withDate && reportDate) drawText(p, `Date: ${reportDate}`, 60, 724, 11, helv, clr.txt);
    }

    // ---- Page 1 ----
    drawHeader(pages[0], true);

    // ---- Pages 2–8 ----
    for (let i=1;i<=7;i++) drawHeader(pages[i], false);

    // ---- Page 9 ----
    (function(){
      const p = pages[8];
      drawHeader(p, false);
      // Section heading
      drawText(p, 'Your Profile — Core', 60, 700, 16, helvB, clr.ink);
      // Fields
      drawText(p, 'Dominant state', 60, 665, 12, helvB, clr.txt);
      drawText(p, dominantLabel || '—', 60, 648, 12, helv, clr.txt);

      drawText(p, 'Character representing', 60, 620, 12, helvB, clr.txt);
      drawText(p, characterLabel || '—', 60, 603, 12, helv, clr.txt);

      drawText(p, 'Title band', 60, 575, 12, helvB, clr.txt);
      drawText(p, titleBandLabel || '—', 60, 558, 12, helv, clr.txt);

      drawText(p, 'Title band explanation', 60, 530, 12, helvB, clr.txt);
      drawPara(p, titleBandText || '—', 60, 512, 11.5, 15, 480, helv, clr.txt, 14);
    })();

    // ---- Page 10 (Spider Chart + explainer) ----
    (function(){
      const p = pages[9];
      drawHeader(p, false);
      drawText(p, 'Spider Chart', 60, 700, 16, helvB, clr.ink);

      // Draw chart
      const cx = 340, cy = 500, radius = 150;
      const labels = ['C_low','C_mid','C_high','T_low','T_mid','T_high','R_low','R_mid','R_high','L_low','L_mid','L_high'];

      // Axes & rings
      const ticks = 4; // 25%,50%,75%,100%
      for (let t=1;t<=ticks;t++){
        const r = (radius*t)/ticks;
        // polygon ring
        let prev=null;
        for (let i=0;i<12;i++){
          const ang = (Math.PI*2*i/12) - Math.PI/2;
          const x = cx + r*Math.cos(ang);
          const y = cy + r*Math.sin(ang);
          if (prev){
            p.drawLine({ start: prev, end: {x,y}, thickness: 0.5, color: clr.faint });
          }
          prev = {x,y};
        }
        // close
        const x0 = cx + r*Math.cos(-Math.PI/2);
        const y0 = cy + r*Math.sin(-Math.PI/2);
        p.drawLine({ start: prev, end: {x:x0,y:y0}, thickness: 0.5, color: clr.faint });
      }
      // spokes + labels
      for (let i=0;i<12;i++){
        const ang = (Math.PI*2*i/12) - Math.PI/2;
        const x = cx + radius*Math.cos(ang);
        const y = cy + radius*Math.sin(ang);
        p.drawLine({ start:{x:cx,y:cy}, end:{x,y}, thickness: 0.5, color: clr.faint });
        // label
        const lx = cx + (radius+18)*Math.cos(ang);
        const ly = cy + (radius+18)*Math.sin(ang);
        drawText(p, labels[i], lx-16, ly-4, 8.5, helv, clr.txt);
      }
      // data polygon
      let first=null, prev=null;
      for (let i=0;i<12;i++){
        const val = Math.max(0, Math.min(1, Number(spiderVals[i]||0)));
        const r = radius*val;
        const ang = (Math.PI*2*i/12) - Math.PI/2;
        const x = cx + r*Math.cos(ang);
        const y = cy + r*Math.sin(ang);
        if (!first) first = {x,y};
        if (prev){
          p.drawLine({ start: prev, end: {x,y}, thickness: 2, color: clr.accent });
        }
        prev = {x,y};
        // small node
        p.drawCircle({ x, y, size: 2.5, color: clr.accent });
      }
      if (first && prev){
        p.drawLine({ start: prev, end: first, thickness: 2, color: clr.accent });
      }

      // Explainer
      drawText(p, 'What this shape suggests', 60, 310, 12, helvB, clr.txt);
      drawPara(p, spiderExpl || '—', 60, 292, 11.5, 15, 500, helv, clr.txt, 18);
    })();

    // ---- Page 11 (Pattern + Themes) ----
    (function(){
      const p = pages[10];
      drawHeader(p, false);
      drawText(p, 'Patterns & Themes', 60, 700, 16, helvB, clr.ink);

      drawText(p, 'Pattern shape', 60, 665, 12, helvB, clr.txt);
      const y1 = drawPara(p, patternExpl || '—', 60, 647, 11.5, 15, 500, helv, clr.txt, 18);

      drawText(p, 'Top themes', 60, Math.max(380, y1-20), 12, helvB, clr.txt);
      drawPara(p, themeExpl || '—', 60, Math.max(362, y1-38), 11.5, 15, 500, helv, clr.txt, 18);
    })();

    // ---- Page 12 (Tips & Actions) ----
    (function(){
      const p = pages[11];
      drawHeader(p, false);
      drawText(p, 'Tips & Actions', 60, 700, 16, helvB, clr.ink);

      drawText(p, 'Tips', 60, 665, 12, helvB, clr.txt);
      let y = 647;
      const bullet = (txt) => {
        y = drawPara(p, `• ${txt}`, 60, y, 11.5, 15, 500, helv, clr.txt, 4) - 6;
      };
      (tips || []).slice(0,4).forEach(t => bullet(t || '—'));
      y -= 10;

      drawText(p, 'Actions', 60, y, 12, helvB, clr.txt); y -= 18;
      (actions || []).slice(0,4).forEach(a => bullet(a || '—'));
    })();

    // ---- Output ----
    const bytes = await pdfDoc.save();
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${outName.replace(/"/g,'')}"`);
    res.end(Buffer.from(bytes));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok:false, error: err?.message || String(err) }));
  }
}
