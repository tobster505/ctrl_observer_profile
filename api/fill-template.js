/**
 * CTRL Observer Export Service · fill-template (OBSERVER 180 V5 · Coach-format routing + timeouts)
 *
 * Matches Coach V5 behaviour:
 * - URL format: /api/fill-template?data=<base64 JSON>
 * - NO tpl= param
 * - Template chosen internally using dominantKey+secondKey => safeCombo
 * - Uses local PDF templates in /public
 *
 * 180 templates expected in /public:
 *   CTRL_PoC_180_Assessment_Report_template_CT.pdf
 *   CTRL_PoC_180_Assessment_Report_template_TR.pdf
 *   ... etc (12 combos)
 */

export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts } from "pdf-lib";

/* ───────── template naming (OBSERVER/180) ───────── */
const TEMPLATE_PREFIX = "CTRL_PoC_180_Assessment_Report_template_";

/* ───────────── small utils ───────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);
const norm = (s) => S(s).replace(/\s+/g, " ").trim();
const okObj = (o) => o && typeof o === "object" && !Array.isArray(o);

function safeJson(obj) {
  try { return JSON.parse(JSON.stringify(obj)); }
  catch { return { _error: "Could not serialise debug object" }; }
}

/* ───────── WinAnsi-safe text normaliser ───────── */
function winAnsiSafe(input) {
  let s = String(input ?? "");

  // Hyphens / dashes
  s = s
    .replace(/\u2010/g, "-")
    .replace(/\u2011/g, "-")
    .replace(/\u2012/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "-")
    .replace(/\u2212/g, "-");

  // Quotes
  s = s
    .replace(/\u2018|\u2019|\u201A|\u201B/g, "'")
    .replace(/\u201C|\u201D|\u201E|\u201F/g, '"');

  // Ellipsis
  s = s.replace(/\u2026/g, "...");

  // Spaces
  s = s
    .replace(/\u00A0/g, " ")
    .replace(/\u2007/g, " ")
    .replace(/\u202F/g, " ");

  return s;
}

/* ───────── filename helpers ───────── */
function clampStrForFilename(s) {
  return S(s)
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_\-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}
function parseDateLabelToYYYYMMDD(dateLbl) {
  const s = S(dateLbl).trim();
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!m) return "";
  const dd = m[1].padStart(2, "0");
  const mon = m[2].toLowerCase();
  const yyyy = m[3];
  const map = {
    jan:"01", january:"01",
    feb:"02", february:"02",
    mar:"03", march:"03",
    apr:"04", april:"04",
    may:"05",
    jun:"06", june:"06",
    jul:"07", july:"07",
    aug:"08", august:"08",
    sep:"09", sept:"09", september:"09",
    oct:"10", october:"10",
    nov:"11", november:"11",
    dec:"12", december:"12"
  };
  const mm = map[mon] || "";
  return mm ? `${yyyy}${mm}${dd}` : "";
}
function makeOutputFilename(fullName, dateLabel) {
  const n = clampStrForFilename(fullName) || "CTRL_Observer_180_Report";
  const d = parseDateLabelToYYYYMMDD(dateLabel) || "";
  return d ? `${n}_180_${d}.pdf` : `${n}_180.pdf`;
}

/* ───────── read payload from ?data= (base64 JSON) ───────── */
async function readPayload(req) {
  const url = new URL(req.url, "http://localhost");
  const dataB64 = url.searchParams.get("data") || "";
  if (!dataB64) throw new Error("Missing data");

  let jsonStr = "";
  try {
    jsonStr = Buffer.from(dataB64, "base64").toString("utf8");
  } catch (e) {
    throw new Error("Bad data base64");
  }

  let obj = null;
  try {
    obj = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error("Bad data JSON");
  }

  if (!okObj(obj)) throw new Error("Parsed data not an object");
  return obj;
}

/* ───────── template loader (local /public) ───────── */
async function loadTemplateBytesLocal(filename) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Vercel places /public at project root
  const p = path.join(__dirname, "..", "..", "public", filename);
  return await fs.readFile(p);
}

/* ───────── layout definition (same structure as Coach V5) ───────── */
const DEFAULT_LAYOUT = {
  pages: {
    p1: {
      name: { x: 70, y: 700, w: 460, h: 22, size: 22, align: "left", maxLines: 1 },
      date: { x: 70, y: 670, w: 460, h: 16, size: 12, align: "left", maxLines: 1 }
    },

    // Pages 2–8 header name
    p2: { hdrName: { x: 70, y: 752, w: 460, h: 14, size: 10, align: "left", maxLines: 1 } },
    p3: {
      hdrName: { x: 70, y: 752, w: 460, h: 14, size: 10, align: "left", maxLines: 1 },
      p3Text: {
        exec1: { x: 70, y: 580, w: 470, h: 110, size: 12, align: "left", maxLines: 12 },
        exec2: { x: 70, y: 450, w: 470, h: 110, size: 12, align: "left", maxLines: 12 }
      },
      p3Q: {
        exec_q1: { x: 70, y: 360, w: 470, h: 30, size: 11, align: "left", maxLines: 2 },
        exec_q2: { x: 70, y: 320, w: 470, h: 30, size: 11, align: "left", maxLines: 2 },
        exec_q3: { x: 70, y: 280, w: 470, h: 30, size: 11, align: "left", maxLines: 2 },
        exec_q4: { x: 70, y: 240, w: 470, h: 30, size: 11, align: "left", maxLines: 2 }
      }
    },
    p4: {
      hdrName: { x: 70, y: 752, w: 460, h: 14, size: 10, align: "left", maxLines: 1 },
      p4Text: {
        ov1: { x: 70, y: 590, w: 470, h: 110, size: 12, align: "left", maxLines: 12 },
        ov2: { x: 70, y: 460, w: 470, h: 110, size: 12, align: "left", maxLines: 12 },
        chart: { x: 300, y: 270, w: 240, h: 160 }
      },
      p4Q: {
        ov_q1: { x: 70, y: 210, w: 470, h: 30, size: 11, align: "left", maxLines: 2 },
        ov_q2: { x: 70, y: 170, w: 470, h: 30, size: 11, align: "left", maxLines: 2 }
      }
    },
    p5: {
      hdrName: { x: 70, y: 752, w: 460, h: 14, size: 10, align: "left", maxLines: 1 },
      p5Text: {
        dd1: { x: 70, y: 590, w: 470, h: 110, size: 12, align: "left", maxLines: 12 },
        dd2: { x: 70, y: 460, w: 470, h: 110, size: 12, align: "left", maxLines: 12 },
        th1: { x: 70, y: 330, w: 470, h: 90,  size: 12, align: "left", maxLines: 10 },
        th2: { x: 70, y: 230, w: 470, h: 90,  size: 12, align: "left", maxLines: 10 }
      },
      p5Q: {
        dd_q1: { x: 70, y: 410, w: 470, h: 28, size: 11, align: "left", maxLines: 2 },
        dd_q2: { x: 70, y: 380, w: 470, h: 28, size: 11, align: "left", maxLines: 2 },
        th_q1: { x: 70, y: 140, w: 470, h: 28, size: 11, align: "left", maxLines: 2 },
        th_q2: { x: 70, y: 110, w: 470, h: 28, size: 11, align: "left", maxLines: 2 }
      }
    },

    /* Page 6 (Coach V5 style: ONLY 2 WorkWith + 2 bottom questions) */
    p6: {
      hdrName: { x: 70, y: 752, w: 460, h: 14, size: 10, align: "left", maxLines: 1 },
      p6WorkWith: {
        collabC: { x: 70, y: 520, w: 470, h: 140, size: 12, align: "left", maxLines: 14 },
        collabT: { x: 70, y: 350, w: 470, h: 140, size: 12, align: "left", maxLines: 14 }
      },
      p6Q: {
        col_q1:  { x: 70, y: 230, w: 470, h: 40, size: 11, align: "left", maxLines: 3 },
        lead_q1: { x: 70, y: 180, w: 470, h: 40, size: 11, align: "left", maxLines: 3 }
      }
    },

    p7: {
      hdrName: { x: 70, y: 752, w: 460, h: 14, size: 10, align: "left", maxLines: 1 },
      p7Actions: {
        act1: { x: 70, y: 520, w: 470, h: 90, size: 12, align: "left", maxLines: 8 },
        act2: { x: 70, y: 400, w: 470, h: 90, size: 12, align: "left", maxLines: 8 },
        act3: { x: 70, y: 280, w: 470, h: 90, size: 12, align: "left", maxLines: 8 }
      }
    },

    p8: { hdrName: { x: 70, y: 752, w: 460, h: 14, size: 10, align: "left", maxLines: 1 } }
  }
};

/* ───────── layout override support (same pattern as Coach) ───────── */
function applyLayoutOverridesFromUrl(layoutPages, url) {
  // Stubbed to “no-op” unless you are already using overrides.
  // Kept here to match Coach structure and keep future compatibility.
  return { layout: layoutPages, applied: [], ignored: [] };
}

/* ───────── text wrapping + drawing ───────── */
function splitLinesToFit(text, maxChars) {
  const raw = norm(winAnsiSafe(text));
  if (!raw) return [];
  const words = raw.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length <= maxChars) line = next;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawTextBox(page, font, text, box, opts = {}) {
  if (!page || !box) return;
  const size = N(box.size, 12);
  const maxLines = N(opts.maxLines, N(box.maxLines, 10));
  const align = box.align || "left";

  // rough char capacity estimate per line
  const maxChars = Math.max(10, Math.floor(N(box.w, 300) / (size * 0.52)));

  const lines = splitLinesToFit(S(text), maxChars).slice(0, maxLines);
  const lh = size + 2;

  let y = N(box.y, 0);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let x = N(box.x, 0);

    // simple alignment
    if (align === "center") {
      const tw = font.widthOfTextAtSize(line, size);
      x = x + (N(box.w, 0) - tw) / 2;
    } else if (align === "right") {
      const tw = font.widthOfTextAtSize(line, size);
      x = x + N(box.w, 0) - tw;
    }

    page.drawText(line, { x, y: y - i * lh, size, font });
  }
}

/* ───────── compute dom/second (same as Coach) ───────── */
function computeDomAndSecondKeys({ raw, domKey, secondKey }) {
  const bands =
    raw?.ctrl?.bands ||
    raw?.bands ||
    {};

  const sumState = (prefix) =>
    N(bands[prefix+"low"]) + N(bands[prefix+"mid"]) + N(bands[prefix+"high"]) ||
    N(bands[prefix+"Low"]) + N(bands[prefix+"Mid"]) + N(bands[prefix+"High"]) ||
    0;

  let D = (S(domKey).toUpperCase() || "").slice(0,1);
  let S2 = (S(secondKey).toUpperCase() || "").slice(0,1);

  if (!D || !S2) {
    const totals = {
      C: sumState("C_"),
      T: sumState("T_"),
      R: sumState("R_"),
      L: sumState("L_")
    };
    const sorted = Object.entries(totals).sort((a,b)=> b[1]-a[1]);
    if (!D)  D  = sorted[0]?.[0] || "";
    if (!S2) S2 = sorted[1]?.[0] || "";
  }

  return {
    domKey: D,
    secondKey: S2,
    templateKey: (D && S2) ? (D + S2) : ""
  };
}

/* ───────── bullet formatting for questions ───────── */
function bulletQ(s) {
  const t = norm(winAnsiSafe(s));
  if (!t) return "";
  // Keep it simple: always prefix a bullet
  return t.startsWith("•") ? t : `• ${t}`;
}

/* ───────── normalise input payload -> draw fields ───────── */
function normaliseInput(d) {
  const identity = okObj(d.identity) ? d.identity : {};
  const text = okObj(d.text) ? d.text : {};
  const actions = okObj(d.actions) ? d.actions : {};

  const fullName = norm(identity.fullName || d.fullName || "");
  const dateLabel = norm(identity.dateLabel || d.dateLbl || "");

  const bandsRaw = okObj(d?.ctrl?.bands) ? d.ctrl.bands : (okObj(d.bands) ? d.bands : {});
  const chartUrl = norm(d.chartUrl || d.spiderChartUrl || d?.chart?.spiderUrl || "");

  // main paragraphs
  const exec = norm(text.exec_summary || "");
  const ov   = norm(text.ctrl_overview || "");
  const dd   = norm(text.ctrl_deepdive || "");
  const th   = norm(text.themes || "");
  const adaptC = norm(text.adapt_with_colleagues || "");
  const adaptL = norm(text.adapt_with_leaders || "");

  // split into 2 paras (simple halfway split by sentence-ish)
  const split2 = (s) => {
    const t = norm(winAnsiSafe(s));
    if (!t) return ["", ""];
    const parts = t.split(/(?<=[.!?])\s+/);
    if (parts.length <= 1) {
      const mid = Math.ceil(t.length / 2);
      return [t.slice(0, mid).trim(), t.slice(mid).trim()];
    }
    const mid = Math.ceil(parts.length / 2);
    return [parts.slice(0, mid).join(" ").trim(), parts.slice(mid).join(" ").trim()];
  };

  const [execA, execB] = split2(exec);
  const [ovA, ovB]     = split2(ov);
  const [ddA, ddB]     = split2(dd);
  const [thA, thB]     = split2(th);

  // actions
  const act1 = norm(actions.actions1 || d.Act1 || "");
  const act2 = norm(actions.actions2 || d.Act2 || "");
  const act3 = norm(actions.actions3 || d.Act3 || "");

  return {
    raw: d,
    identity: { fullName, dateLabel },
    bands: bandsRaw,

    exec_summary_para1: execA,
    exec_summary_para2: execB,

    ctrl_overview_para1: ovA,
    ctrl_overview_para2: ovB,

    ctrl_deepdive_para1: ddA,
    ctrl_deepdive_para2: ddB,

    themes_para1: thA,
    themes_para2: thB,

    // questions
    exec_q1: bulletQ(text.exec_summary_q1),
    exec_q2: bulletQ(text.exec_summary_q2),
    exec_q3: bulletQ(text.exec_summary_q3),
    exec_q4: bulletQ(text.exec_summary_q4),

    ov_q1: bulletQ(text.ctrl_overview_q1),
    ov_q2: bulletQ(text.ctrl_overview_q2),

    dd_q1: bulletQ(text.ctrl_deepdive_q1),
    dd_q2: bulletQ(text.ctrl_deepdive_q2),

    th_q1: bulletQ(text.themes_q1),
    th_q2: bulletQ(text.themes_q2),

    col_q1: bulletQ(text.adapt_with_colleagues_q1),
    lead_q1: bulletQ(text.adapt_with_leaders_q2),

    workWith: {
      concealed: adaptC,
      triggered: adaptL,
    },

    Act1: act1,
    Act2: act2,
    Act3: act3,

    chartUrl,
  };
}

/* ───────── fetch with timeout to prevent 504 hangs ───────── */
async function fetchWithTimeout(url, ms = 6500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(t);
  }
}

/* ───────── embed radar chart (bands OR remote chartUrl) ───────── */
async function embedRadarFromBandsOrUrl(pdfDoc, page, box, bands, chartUrl) {
  // If you have a deterministic chart renderer elsewhere, chartUrl can be used.
  // BUT remote fetch must be timed-out to avoid Vercel hanging.
  if (!pdfDoc || !page || !box) return;

  // Prefer remote chartUrl if provided (same as Coach logic)
  if (chartUrl) {
    const imgBytes = await fetchWithTimeout(chartUrl, 6500);
    // png assumed; if you use jpg, you can detect by signature
    const img = await pdfDoc.embedPng(imgBytes);
    page.drawImage(img, { x: box.x, y: box.y, width: box.w, height: box.h });
    return;
  }

  // If no chartUrl, do nothing (bands-only render not implemented here)
  // This matches your current stack where chartUrl is typically provided.
}

/* ───────── debug probe ───────── */
function buildProbe(P, domSecond, tpl, ov) {
  return {
    ok: true,
    where: "fill-template:OBSERVER_180:debug",
    template: tpl,
    domSecond: safeJson(domSecond),
    identity: { fullName: P.identity.fullName, dateLabel: P.identity.dateLabel },
    textLengths: {
      exec1: S(P.exec_summary_para1).length,
      exec2: S(P.exec_summary_para2).length,
      ov1: S(P.ctrl_overview_para1).length,
      ov2: S(P.ctrl_overview_para2).length,
      dd1: S(P.ctrl_deepdive_para1).length,
      dd2: S(P.ctrl_deepdive_para2).length,
      th1: S(P.themes_para1).length,
      th2: S(P.themes_para2).length,
      adapt_colleagues: S(P.workWith?.concealed).length,
      adapt_leaders: S(P.workWith?.triggered).length,
      act1: S(P.Act1).length,
      act2: S(P.Act2).length,
      act3: S(P.Act3).length,

      exec_q1: S(P.exec_q1).length,
      exec_q2: S(P.exec_q2).length,
      exec_q3: S(P.exec_q3).length,
      exec_q4: S(P.exec_q4).length,
      ov_q1: S(P.ov_q1).length,
      ov_q2: S(P.ov_q2).length,
      dd_q1: S(P.dd_q1).length,
      dd_q2: S(P.dd_q2).length,
      th_q1: S(P.th_q1).length,
      th_q2: S(P.th_q2).length,
      col_q1: S(P.col_q1).length,
      lead_q1: S(P.lead_q1).length,
    },
    chart: {
      chartUrl: P.chartUrl ? P.chartUrl.slice(0, 140) : "",
      hasChartUrl: !!P.chartUrl
    },
    layoutOverrides: {
      appliedCount: ov?.applied?.length || 0,
      ignoredCount: ov?.ignored?.length || 0,
      applied: ov?.applied || [],
      ignored: ov?.ignored || [],
    },
  };
}

/* ───────── main handler ───────── */
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const debug = url.searchParams.get("debug") === "1";

    const payload = await readPayload(req);
    const P = normaliseInput(payload);

    const domSecond = computeDomAndSecondKeys({
      raw: payload,
      domKey: payload?.ctrl?.dominantKey || payload?.dominantKey,
      secondKey: payload?.ctrl?.secondKey || payload?.secondKey
    });

    const validCombos = new Set(["CT","CL","CR","TC","TR","TL","RC","RT","RL","LC","LR","LT"]);
    const safeCombo = validCombos.has(domSecond.templateKey) ? domSecond.templateKey : "CT";

    const tpl = {
      combo: domSecond.templateKey,
      safeCombo,
      tpl: `${TEMPLATE_PREFIX}${safeCombo}.pdf`
    };

    if (!DEFAULT_LAYOUT || !DEFAULT_LAYOUT.pages) {
      throw new Error("DEFAULT_LAYOUT missing.");
    }

    const L = safeJson(DEFAULT_LAYOUT.pages);
    const ov = applyLayoutOverridesFromUrl(L, url);

    if (debug) return res.status(200).json(buildProbe(P, domSecond, tpl, ov));

    const pdfBytes = await loadTemplateBytesLocal(tpl.tpl);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pages = pdfDoc.getPages();

    // Page 1
    if (pages[0]) {
      drawTextBox(pages[0], fontB, P.identity.fullName, L.p1.name, { maxLines: 1 });
      drawTextBox(pages[0], font,  P.identity.dateLabel, L.p1.date, { maxLines: 1 });
    }

    // Header name pages 2–8
    const headerName = norm(P.identity.fullName);
    if (headerName) {
      for (let i = 1; i < Math.min(pages.length, 8); i++) {
        const pk = `p${i + 1}`;
        const box = L?.[pk]?.hdrName;
        if (box) drawTextBox(pages[i], font, headerName, box, { maxLines: 1 });
      }
    }

    const p3 = pages[2] || null;
    const p4 = pages[3] || null;
    const p5 = pages[4] || null;
    const p6 = pages[5] || null;
    const p7 = pages[6] || null;

    if (p3) {
      drawTextBox(p3, font, P.exec_summary_para1, L.p3Text.exec1);
      drawTextBox(p3, font, P.exec_summary_para2, L.p3Text.exec2);

      drawTextBox(p3, font, P.exec_q1, L.p3Q.exec_q1);
      drawTextBox(p3, font, P.exec_q2, L.p3Q.exec_q2);
      drawTextBox(p3, font, P.exec_q3, L.p3Q.exec_q3);
      drawTextBox(p3, font, P.exec_q4, L.p3Q.exec_q4);
    }

    if (p4) {
      drawTextBox(p4, font, P.ctrl_overview_para1, L.p4Text.ov1);
      drawTextBox(p4, font, P.ctrl_overview_para2, L.p4Text.ov2);

      try {
        await embedRadarFromBandsOrUrl(pdfDoc, p4, L.p4Text.chart, P.bands || {}, P.chartUrl);
      } catch (e) {
        console.warn("[fill-template:OBSERVER_180] Chart skipped:", e?.message || String(e));
      }

      drawTextBox(p4, font, P.ov_q1, L.p4Q.ov_q1);
      drawTextBox(p4, font, P.ov_q2, L.p4Q.ov_q2);
    }

    if (p5) {
      drawTextBox(p5, font, P.ctrl_deepdive_para1, L.p5Text.dd1);
      drawTextBox(p5, font, P.ctrl_deepdive_para2, L.p5Text.dd2);

      drawTextBox(p5, font, P.themes_para1, L.p5Text.th1);
      drawTextBox(p5, font, P.themes_para2, L.p5Text.th2);

      drawTextBox(p5, font, P.dd_q1, L.p5Q.dd_q1);
      drawTextBox(p5, font, P.dd_q2, L.p5Q.dd_q2);
      drawTextBox(p5, font, P.th_q1, L.p5Q.th_q1);
      drawTextBox(p5, font, P.th_q2, L.p5Q.th_q2);
    }

    if (p6) {
      // Only the 2 WorkWith boxes
      drawTextBox(p6, font, P.workWith?.concealed, L.p6WorkWith.collabC);
      drawTextBox(p6, font, P.workWith?.triggered, L.p6WorkWith.collabT);

      // Questions drawn into bottom template fields
      drawTextBox(p6, font, P.col_q1,  L.p6Q.col_q1);
      drawTextBox(p6, font, P.lead_q1, L.p6Q.lead_q1);
    }

    if (p7) {
      drawTextBox(p7, font, P.Act1, L.p7Actions.act1);
      drawTextBox(p7, font, P.Act2, L.p7Actions.act2);
      drawTextBox(p7, font, P.Act3, L.p7Actions.act3);
    }

    const outBytes = await pdfDoc.save();
    const outName = makeOutputFilename(P.identity.fullName, P.identity.dateLabel);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
    res.status(200).send(Buffer.from(outBytes));
  } catch (err) {
    console.error("[fill-template:OBSERVER_180] CRASH", err);
    res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      stack: err?.stack || null,
    });
  }
}
