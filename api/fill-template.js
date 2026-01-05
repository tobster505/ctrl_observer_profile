// api/fill-template.js
// Runtime: Node.js (ESM). Make sure package.json has: { "type": "module" }
export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ───────────────────────── helpers ───────────────────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);
const norm = (v, fb = "") =>
  S(v, fb)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");

/** Query param helpers */
const qstr = (url, k, fb = "") => {
  try {
    const u = new URL(url);
    return u.searchParams.get(k) ?? fb;
  } catch {
    return fb;
  }
};
const qnum = (url, k, fb = 0) => {
  const v = qstr(url, k, "");
  return v === "" ? fb : N(v, fb);
};

/** Draw wrapped text in a box (top-left coordinate system via y from top) */
function drawTextBox(page, font, text, box, opts = {}) {
  const {
    x,
    y, // from top
    w,
    size = 12,
    color = rgb(0, 0, 0),
    align = "left",
  } = box;

  const pageH = page.getHeight();
  const lineGap = opts.lineGap ?? 3;
  const maxLines = opts.maxLines ?? 1000;
  const ellipsis = opts.ellipsis ?? false;

  // naive wrapping
  const words = norm(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";

  const widthOf = (s) => font.widthOfTextAtSize(s, size);

  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (widthOf(test) <= w) cur = test;
    else {
      if (cur) lines.push(cur);
      cur = word;
    }
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);

  // Ellipsis if overflow
  let finalLines = lines.slice(0, maxLines);
  if (ellipsis && lines.length > maxLines && finalLines.length) {
    let last = finalLines[finalLines.length - 1];
    while (last.length && widthOf(last + "…") > w) last = last.slice(0, -1);
    finalLines[finalLines.length - 1] = (last || "").trimEnd() + "…";
  }

  const lineHeight = size + lineGap;
  let curY = pageH - y - size;

  for (const ln of finalLines) {
    if (curY < 0) break;

    let dx = x;
    const lw = widthOf(ln);
    if (align === "center") dx = x + (w - lw) / 2;
    else if (align === "right") dx = x + (w - lw);

    page.drawText(ln, { x: dx, y: curY, size, font, color });
    curY -= lineHeight;
  }

  return { lines: finalLines.length };
}

function dropLeadingLabel(s) {
  const t = norm(s || "");
  // Removes "P.xxxx = " style labels if present
  return t.replace(/^\s*P\.[A-Za-z0-9_]+\s*=\s*/i, "");
}

/* ───────────────────── spider chart helpers ───────────────────── */
// We want the SAME chart style as the User Profile (polarArea via QuickChart).
// Input can arrive in several shapes; we normalise to ctrl12 bands in the fixed order.

const CTRL12_ORDER = [
  "C_low","C_mid","C_high",
  "T_low","T_mid","T_high",
  "R_low","R_mid","R_high",
  "L_low","L_mid","L_high"
];

function isObj(v){ return v && typeof v === "object" && !Array.isArray(v); }

function pickCtrl12Bands(payload){
  const d = payload || {};
  // Most common / preferred paths (your JsonSummaryObj)
  const p1 = d?.ScoringTruth?.PoC_FINAL?.ctrl12;
  const p2 = d?.scoringTruth?.PoC_FINAL?.ctrl12;
  const p3 = d?.PoC_FINAL?.ctrl12;
  // Other likely shapes
  const p4 = d?.ctrl12;
  const p5 = d?.bands;
  const p6 = d?.ctrl?.bands || d?.ctrl?.ctrl12;
  const p7 = d?.raw?.ctrl12;

  const cand = [p1,p2,p3,p4,p5,p6,p7].find(x => isObj(x) && Object.keys(x).length > 0);
  if (!isObj(cand)) return null;

  const out = {};
  for (const k of CTRL12_ORDER) out[k] = N(cand[k], 0);
  return out;
}

function makeSpiderChartUrl12(ctrl12Bands, opts = {}) {
  const width  = Math.max(300, Math.min(2000, N(opts.width, 900)));
  const height = Math.max(300, Math.min(2000, N(opts.height, 900)));

  const b = ctrl12Bands || {};
  const vals = CTRL12_ORDER.map(k => Math.max(0, N(b[k], 0)));

  // Map 12 bands -> 4 primary states (average of 3 bands each)
  const stateVals = [
    (vals[0] + vals[1] + vals[2]) / 3,     // Concealed
    (vals[3] + vals[4] + vals[5]) / 3,     // Triggered
    (vals[6] + vals[7] + vals[8]) / 3,     // Regulated
    (vals[9] + vals[10] + vals[11]) / 3    // Lead
  ];

  // Clamp to 0..1 for stable rendering
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const data = stateVals.map(clamp01);

  // QuickChart polarArea
  const cfg = {
    type: "polarArea",
    data: {
      labels: ["Concealed", "Triggered", "Regulated", "Lead"],
      datasets: [{
        label: "CTRL",
        data
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { r: { suggestedMin: 0, suggestedMax: 1, ticks: { display: false } } }
    }
  };

  const enc = encodeURIComponent(JSON.stringify(cfg));
  return `https://quickchart.io/chart?c=${enc}&w=${width}&h=${height}&bkg=white`;
}

async function embedRemoteImage(pdfDoc, page, imgUrl, box) {
  const r = await fetch(imgUrl);
  if (!r.ok) throw new Error(`image fetch failed: ${r.status} ${r.statusText}`);
  const buf = new Uint8Array(await r.arrayBuffer());

  // Try PNG first, then JPG
  let img = null;
  try { img = await pdfDoc.embedPng(buf); } catch {}
  if (!img) img = await pdfDoc.embedJpg(buf);

  const ph = page.getHeight();
  const { x, y, w, h } = box;

  // "contain" so we do not squash charts
  const iw = img.width, ih = img.height;
  const s = Math.min(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  const dx = x + (w - dw) / 2;
  const dy = (ph - y - h) + (h - dh) / 2;

  page.drawImage(img, { x: dx, y: dy, width: dw, height: dh });
  return true;
}

async function embedRadarFromBandsOrUrl(pdfDoc, page, box, payload, explicitUrl) {
  const ctrl12 = pickCtrl12Bands(payload);
  const url = S(explicitUrl || "", "");
  const finalUrl = url || (ctrl12 ? makeSpiderChartUrl12(ctrl12, { width: 900, height: 900 }) : "");
  if (!finalUrl) return false;
  await embedRemoteImage(pdfDoc, page, finalUrl, box);
  return true;
}

/* ───────────────────────── template fetch ───────────────────────── */
async function fetchPdfBytes(templateUrl) {
  const r = await fetch(templateUrl);
  if (!r.ok) throw new Error(`Template fetch failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

/* ───────────────────────── default layout ───────────────────────── */
const DEFAULT_LAYOUT = {
  // (unchanged) — your existing layout boxes
  p6: {
    why6:    { x: 90,  y: 355, w: 650, size: 12, align: "left", max: 12, lineGap: 3 },
    how6:    { x: 90,  y: 505, w: 650, size: 12, align: "left", max: 12, lineGap: 3 },
    chart6:  { x: 213, y: 250, w: 410, h: 230 },
  },
  // other pages kept as-is below…
};

/* ───────────────────────── handler ───────────────────────── */
export default async function handler(req) {
  try {
    const url = req.url || "";
    const u = new URL(url, "http://localhost");

    // Template selection
    const tpl = u.searchParams.get("tpl") || u.searchParams.get("template") || "";
    if (!tpl) return new Response(JSON.stringify({ ok: false, error: "Missing tpl" }), { status: 400 });

    // Payload is base64 JSON in ?data=...
    const dataB64 = u.searchParams.get("data") || "";
    if (!dataB64) return new Response(JSON.stringify({ ok: false, error: "Missing data" }), { status: 400 });

    let data = {};
    try {
      const jsonStr = Buffer.from(dataB64, "base64").toString("utf8");
      data = JSON.parse(jsonStr);
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "Bad data JSON" }), { status: 400 });
    }

    // Load template
    const pdfBytes = await fetchPdfBytes(tpl);
    const pdf = await PDFDocument.load(pdfBytes);
    const Helv = await pdf.embedFont(StandardFonts.Helvetica);

    // Override layout via query params (kept as-is)
    const POS = JSON.parse(JSON.stringify(DEFAULT_LAYOUT.p6));

    POS.why6 = {
      ...POS.why6,
      x: qnum(url, "why6x", POS.why6.x),
      y: qnum(url, "why6y", POS.why6.y),
      w: qnum(url, "why6w", POS.why6.w),
      size: qnum(url, "why6s", POS.why6.size),
      max: qnum(url, "why6max", POS.why6.max),
    };
    POS.how6 = {
      ...POS.how6,
      x: qnum(url, "how6x", POS.how6.x),
      y: qnum(url, "how6y", POS.how6.y),
      w: qnum(url, "how6w", POS.how6.w),
      size: qnum(url, "how6s", POS.how6.size),
      max: qnum(url, "how6max", POS.how6.max),
    };
    POS.chart6 = {
      x: qnum(url, "c6x", POS.chart6.x),
      y: qnum(url, "c6y", POS.chart6.y),
      w: qnum(url, "c6w", POS.chart6.w),
      h: qnum(url, "c6h", POS.chart6.h),
    };

    // Pages
    const pages = pdf.getPages();
    const page9 = pages[8]; // (unchanged assumption from your current file)

    if (page9) {
      const why6Text = dropLeadingLabel(data?.why6 || data?.p6_why || "");
      const how6Text = dropLeadingLabel(data?.how6 || data?.p6_how || "");

      // Auto-fit WHY block
      const DEFAULT_LINE_GAP = 3;
      const whyLineHeight = (POS.why6?.size ?? 12) + (POS.why6?.lineGap ?? DEFAULT_LINE_GAP);
      const whyAvailable  = page9.getHeight() - (POS.why6?.y ?? 0);
      const whyFitLines   = Math.max(1, Math.floor(whyAvailable / whyLineHeight));
      const whyMaxLines   = Math.min((POS.why6?.max ?? 12), whyFitLines);

      if (why6Text) {
        drawTextBox(
          page9,
          Helv,
          why6Text,
          { ...POS.why6, color: rgb(0.24,0.23,0.35), align: POS.why6.align },
          { maxLines: whyMaxLines, ellipsis: true }
        );
      }

      // Auto-fit HOW block
      const howLineHeight = (POS.how6?.size ?? 12) + (POS.how6?.lineGap ?? DEFAULT_LINE_GAP);
      const howAvailable  = page9.getHeight() - (POS.how6?.y ?? 0);
      const howFitLines   = Math.max(1, Math.floor(howAvailable / howLineHeight));
      const howMaxLines   = Math.min((POS.how6?.max ?? 12), howFitLines);

      if (how6Text) {
        drawTextBox(
          page9,
          Helv,
          how6Text,
          { ...POS.how6, color: rgb(0.24,0.23,0.35), align: POS.how6.align },
          { maxLines: howMaxLines, ellipsis: true }
        );
      }

      // Chart image
      // Prefer an explicit URL if provided, otherwise generate from ctrl12 bands (same style as User profile).
      try {
        await embedRadarFromBandsOrUrl(
          pdf,
          page9,
          POS.chart6,
          data,
          (data?.chartUrl || data?.spiderChartUrl || data?.spider?.chartUrl || "")
        );
      } catch { /* ignore image failure */ }
    }

    const outBytes = await pdf.save();
    return new Response(outBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), { status: 500 });
  }
}
