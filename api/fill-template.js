// /api/fill-template.js
export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { promises as fs } from "fs";
import path from "path";

/* =============================== STRICT TEMPLATE LOAD =============================== */
const ALLOWED_TEMPLATES = new Set([
  "CTRL_Observer_Assessment_Profile_template_v1.pdf",
  // add more filenames if you ship additional templates in /public
]);

async function fetchTemplateFromDisk(url) {
  const tplParam = url?.searchParams?.get("tpl")?.trim()
    || "CTRL_Observer_Assessment_Profile_template_v1.pdf";
  const filename = path.basename(tplParam); // strip any path
  if (!ALLOWED_TEMPLATES.has(filename)) {
    throw new Error(`Template not allowed or missing: ${filename}`);
  }
  const abs = path.join(process.cwd(), "public", filename);
  return await fs.readFile(abs); // Buffer
}

/* =============================== TINY HELPERS =============================== */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);
const norm = (v, fb = "") =>
  S(v, fb)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");

// align: left | center | right | justify | centre
const alignNorm = (a) => {
  const v = String(a || "").toLowerCase();
  if (v === "centre") return "center";
  return ["left", "right", "center", "justify"].includes(v) ? v : "left";
};

const todayLbl = () => {
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const d = new Date();
  return `${String(d.getDate()).padStart(2,"0")}/${MMM[d.getMonth()]}/${d.getFullYear()}`;
};

const defaultFileName = (fullName) => {
  const who = S(fullName || "report").replace(/[^A-Za-z0-9_-]+/g,"_").replace(/^_+|_+$/g,"");
  const MMM = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const d = new Date();
  return `CTRL_${who}_${String(d.getDate()).padStart(2,"0")}${MMM[d.getMonth()]}${d.getFullYear()}.pdf`;
};

/* =============================== TEXT RENDERING =============================== */
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const {
    x = 40, y = 40, w = 540, size = 12, lineGap = 3,
    color = rgb(0, 0, 0), align = "left",
  } = spec;

  const maxLines = opts.maxLines ?? 6;
  const ellipsis = !!opts.ellipsis;

  const clean = norm(text);
  if (!clean) return { height: 0, linesDrawn: 0, lastY: page.getHeight() - y };

  const lines = clean.split("\n");
  const avgCharW = size * 0.55;
  const maxChars = Math.max(8, Math.floor(w / avgCharW));
  const wrapped = [];

  for (const raw of lines) {
    let t = raw.trim();
    while (t.length > maxChars) {
      let cut = t.lastIndexOf(" ", maxChars);
      if (cut <= 0) cut = maxChars;
      wrapped.push(t.slice(0, cut).trim());
      t = t.slice(cut).trim();
    }
    if (t) wrapped.push(t);
  }

  const out = wrapped.length > maxLines
    ? wrapped.slice(0, maxLines).map((s, i, a) => (i === a.length - 1 && ellipsis ? s.replace(/\.*$/, "…") : s))
    : wrapped;

  const pageH   = page.getHeight();
  const yTop    = pageH - y;
  const widthOf = (s) => font.widthOfTextAtSize(s, size);
  const spaceW  = widthOf(" ");
  const lineH   = size + lineGap;

  let yCursor = yTop;
  let drawn = 0;

  for (let i = 0; i < out.length; i++) {
    const line = out[i];
    const isLast = i === out.length - 1;

    if (align === "justify" && !isLast) {
      const words = line.split(/\s+/).filter(Boolean);
      if (words.length > 1) {
        const wordsW = words.reduce((s, w) => s + widthOf(w), 0);
        const gaps   = words.length - 1;
        const natural = wordsW + gaps * spaceW;
        const extra   = Math.max(0, w - natural);
        const gapAdd  = extra / gaps;

        let xCursor = x;
        for (let wi = 0; wi < words.length; wi++) {
          const word = words[wi];
          page.drawText(word, { x: xCursor, y: yCursor, size, font, color });
          const advance = widthOf(word) + (wi < gaps ? (spaceW + gapAdd) : 0);
          xCursor += advance;
        }
        yCursor -= lineH;
        drawn++;
        continue;
      }
    }

    let xDraw = x;
    if (align === "center") xDraw = x + (w - widthOf(line)) / 2;
    else if (align === "right") xDraw = x + (w - widthOf(line));
    page.drawText(line, { x: xDraw, y: yCursor, size, font, color });
    yCursor -= lineH;
    drawn++;
  }
  return { height: drawn * lineH, linesDrawn: drawn, lastY: yCursor };
}

/* =============================== LOCKED POSITIONS =============================== */
/* These match what you showed (page 1 footer/header; p6/p7 blocks). */
const POS = {
  // PAGE 1
  f1: { x: 290, y: 170, w: 400, size: 40, align: "left" },     // Path name (e.g., Observer)
  n1: { x: 10,  y: 573, w: 500, size: 30, align: "center" },   // Full name
  d1: { x: 130, y: 630, w: 500, size: 20, align: "left" },     // Date
  footer: {
    f2: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n2: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    f3: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n3: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    f4: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n4: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    f5: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n5: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    f6: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n6: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    f7: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n7: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    f8: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n8: { x: 250, y: 64, w: 400, size: 12, align: "center" },
    f9: { x: 200, y: 64, w: 400, size: 13, align: "left" }, n9: { x: 250, y: 64, w: 400, size: 12, align: "center" },
  },

  // PAGE 6 (dominant page)
  dom6:     { x: 55,  y: 280, w: 900, size: 33, align: "left" },
  dom6desc: { x: 25,  y: 360, w: 265, size: 15, align: "left", max: 8 },
  how6:     { x: 30,  y: 600, w: 660, size: 17, align: "left", max: 12 },
  chart6:   { x: 213, y: 250, w: 410, h: 230 }, // optional PNG

  // PAGE 7 (patterns/tips/actions)
  p7Patterns:  { x: 30,  y: 175, w: 660, hSize: 7,  bSize: 16, align:"left", titleGap: 10, blockGap: 20, maxBodyLines: 20 },
  p7Tips:      { x: 30,  y: 530, w: 300, size: 17, align: "left", maxLines: 12 },
  p7Acts:      { x: 320, y: 530, w: 300, size: 17, align: "left", maxLines: 12 },
};

/* =============================== HANDLER =============================== */
export default async function handler(req, res) {
  let url;
  try { url = new URL(req?.url || "/", "http://localhost"); }
  catch { url = new URL("/", "http://localhost"); }

  // require ?data
  const b64 = url.searchParams.get("data");
  if (!b64) { res.statusCode = 400; res.end("Missing ?data"); return; }

  // parse JSON payload
  let data;
  try {
    const raw = Buffer.from(String(b64), "base64").toString("utf8");
    data = JSON.parse(raw);
  } catch (e) {
    res.statusCode = 400; res.end("Invalid ?data: " + (e?.message || e)); return;
  }

  try {
    // strict local template
    const tplBytes = await fetchTemplateFromDisk(url);
    const pdf = await PDFDocument.load(tplBytes);
    const Helv  = await pdf.embedFont(StandardFonts.Helvetica);
    const HelvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    // page refs
    const page1 = pdf.getPage(0);
    const page6 = pdf.getPage(5);
    const page7 = pdf.getPage(6);
    const pageCount = pdf.getPageCount();

    /* ---------------- PAGE 1 ---------------- */
    const pathName = norm(S(data?.flow || "Observer"));
    const fullName = norm(S(data?.person?.fullName || data?.person?.coverName || ""));
    const dateLbl  = norm(S(data?.dateLbl || todayLbl()));

    const drawFooter = (page, fSpec, nSpec) => {
      drawTextBox(page, Helv, pathName, { ...fSpec, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
      drawTextBox(page, Helv, fullName, { ...nSpec, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
    };

    drawTextBox(page1, HelvB, pathName, { ...POS.f1, color: rgb(0.12,0.11,0.2) }, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, HelvB, fullName, { ...POS.n1, color: rgb(0.12,0.11,0.2) }, { maxLines: 1, ellipsis: true });
    drawTextBox(page1, Helv,  dateLbl,  { ...POS.d1, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });

    // footers 2..9
    for (let i = 2; i <= Math.min(9, pageCount); i++) {
      const p = pdf.getPage(i - 1);
      const f = POS.footer[`f${i}`], n = POS.footer[`n${i}`];
      if (f && n) drawFooter(p, f, n);
    }

    /* ---------------- PAGE 6 (dominant) ---------------- */
    const domLabel = norm(data?.dom6Label || data?.dom6 || "");
    const domDesc  = norm(data?.dominantDesc || data?.dom6Desc || "");
    const how6Text = norm(data?.how6 || data?.how6Text || data?.chartParagraph || "");

    if (domLabel) {
      drawTextBox(page6, HelvB, domLabel, { ...POS.dom6, color: rgb(0.12,0.11,0.2) }, { maxLines: 1, ellipsis: true });
    }
    if (domDesc) {
      drawTextBox(page6, Helv, domDesc, { ...POS.dom6desc, color: rgb(0.24,0.23,0.35), align: POS.dom6desc.align }, { maxLines: POS.dom6desc.max, ellipsis: true });
    }

    // auto-fit HOW block: respect y/size, clamp by page height
    const DEFAULT_LINE_GAP = 3;
    const howLineHeight = (POS.how6?.size ?? 12) + (POS.how6?.lineGap ?? DEFAULT_LINE_GAP);
    const howAvailable  = page6.getHeight() - (POS.how6?.y ?? 0);
    const howMaxLines   = Math.min((POS.how6?.max ?? 12), Math.max(1, Math.floor(howAvailable / howLineHeight)));

    if (how6Text) {
      drawTextBox(page6, Helv, how6Text, { ...POS.how6, color: rgb(0.24,0.23,0.35), align: POS.how6.align }, { maxLines: howMaxLines, ellipsis: true });
    }

    // optional chart image (PNG) — provide data.chartUrl (public PNG URL) if you want it drawn
    if (data?.chartUrl) {
      try {
        const r = await fetch(data.chartUrl);
        if (r.ok) {
          const png = await pdf.embedPng(await r.arrayBuffer());
          const { x, y, w, h } = POS.chart6;
          const ph = page6.getHeight();
          page6.drawImage(png, { x, y: ph - y - h, width: w, height: h });
        }
      } catch { /* ignore image failure */ }
    }

    /* ---------------- PAGE 7 (patterns / tips / actions) ---------------- */
    // You can pre-assemble page7 texts in Botpress and pass as:
    //   page7Blocks: [{ body: "…" }, …]  (we’ll print bodies; titles are ignored for simplicity)
    const blocks = Array.isArray(data?.page7Blocks) ? data.page7Blocks : [];
    let curY = POS.p7Patterns.y;
    for (const b of blocks.slice(0, 3)) {
      const body = norm(b?.body || "");
      if (!body) continue;
      const r = drawTextBox(
        page7,
        Helv,
        body,
        { x: POS.p7Patterns.x, y: curY, w: POS.p7Patterns.w, size: POS.p7Patterns.bSize, align: POS.p7Patterns.align, color: rgb(0.24,0.23,0.35) },
        { maxLines: POS.p7Patterns.maxBodyLines, ellipsis: true }
      );
      curY += r.height + POS.p7Patterns.blockGap;
    }

    // Tips & Actions — pass simple arrays: tips2:[], actions2:[]
    const tips = (Array.isArray(data?.tips2) ? data.tips2 : []).map(norm).filter(Boolean);
    const acts = (Array.isArray(data?.actions2) ? data.actions2 : []).map(norm).filter(Boolean);

    drawTextBox(page7, Helv, tips.map(t => `• ${t}`).join("\n"),
      { x: POS.p7Tips.x, y: POS.p7Tips.y, w: POS.p7Tips.w, size: POS.p7Tips.size, align: POS.p7Tips.align, color: rgb(0.24,0.23,0.35) },
      { maxLines: POS.p7Tips.maxLines, ellipsis: true }
    );
    drawTextBox(page7, Helv, acts.map(a => `• ${a}`).join("\n"),
      { x: POS.p7Acts.x, y: POS.p7Acts.y, w: POS.p7Acts.w, size: POS.p7Acts.size, align: POS.p7Acts.align, color: rgb(0.24,0.23,0.35) },
      { maxLines: POS.p7Acts.maxLines, ellipsis: true }
    );

    /* ---------------- SAVE ---------------- */
    const bytes = await pdf.save();
    const preview = url.searchParams.get("preview") === "1";
    const fname = S(url.searchParams.get("name")) || defaultFileName(data?.person?.fullName);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${preview ? "inline" : "attachment"}; filename="${fname}"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end("fill-template error: " + (e?.message || e));
  }
}
