/**
 * CTRL Observer Export Service · fill-template (OBSERVER 180 V6.3)
 *
 * V6.3 changes (ONLY):
 * - Implement URL-driven layout overrides via &L_... params
 * - Support top-origin y coords from URL (default), with optional &L_origin=bottom
 * - Apply y conversion in drawTextBox and embedChartIfPresent when _yFromTop is set
 *
 * Base: OBSERVER 180 V6.2 (working)
 */

export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts } from "pdf-lib";

/* ───────── template naming (OBSERVER/180) ───────── */
const TEMPLATE_PREFIX = "CTRL_PoC_180_Assessment_Report_template_"; // must match filenames in /public
const TEMPLATE_EXT = ".pdf";

/* ───────── utils ───────── */
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

  // Dashes
  s = s
    .replace(/\u2010|\u2011|\u2012|\u2013|\u2014|\u2212/g, "-");

  // Quotes
  s = s
    .replace(/\u2018|\u2019|\u201A|\u201B/g, "'")
    .replace(/\u201C|\u201D|\u201E|\u201F/g, '"');

  // Ellipsis
  s = s.replace(/\u2026/g, "...");

  // Spaces
  s = s
    .replace(/\u00A0|\u2007|\u202F/g, " ");

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
  } catch {
    throw new Error("Bad data base64");
  }

  let obj = null;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    throw new Error("Bad data JSON");
  }

  if (!okObj(obj)) throw new Error("Parsed data not an object");
  return obj;
}

/* ───────── robust /public resolver (Vercel-safe) ───────── */
function getPublicDirCandidates() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const cwd = process.cwd(); // usually /var/task on Vercel
  const candidates = [
    path.join(cwd, "public"),
    "/var/task/public",
    "/var/task/.next/server/public",
    path.join(__dirname, "..", "public"),
    path.join(__dirname, "..", "..", "public"),
    path.join(__dirname, "..", "..", "..", "public"),
  ];

  return Array.from(new Set(candidates));
}

async function listTemplatesInDir(dir) {
  try {
    const items = await fs.readdir(dir);
    return items
      .filter(f => f.startsWith(TEMPLATE_PREFIX) && f.endsWith(TEMPLATE_EXT))
      .sort();
  } catch {
    return [];
  }
}

async function resolveTemplateFile(safeCombo) {
  const candidates = getPublicDirCandidates();

  const desired = `${TEMPLATE_PREFIX}${safeCombo}${TEMPLATE_EXT}`;
  const fallback = `${TEMPLATE_PREFIX}fallback${TEMPLATE_EXT}`;

  for (const pub of candidates) {
    const full = path.join(pub, desired);
    try {
      await fs.access(full);
      return { found: true, pubDir: pub, file: desired, fullPath: full, fallbackUsed: false, candidates };
    } catch { /* keep trying */ }
  }

  for (const pub of candidates) {
    const full = path.join(pub, fallback);
    try {
      await fs.access(full);
      return { found: true, pubDir: pub, file: fallback, fullPath: full, fallbackUsed: true, candidates };
    } catch { /* keep trying */ }
  }

  return { found: false, desired, fallback, candidates };
}

// ───────── template bytes loader (already fixed) ─────────
async function loadTemplateBytes(fullPath) {
  return await fs.readFile(fullPath);
}

/* ───────── DEFAULT LAYOUT (UPDATED to your latest top-origin coords) ─────────
   IMPORTANT:
   - These coordinate values are TOP-ORIGIN (your preferred style).
   - We set `_yFromTop: true` on each updated box so drawTextBox/embedChart converts correctly.
*/
const DEFAULT_LAYOUT = {
  pages: {
    // Page 1
    p1: {
      name: { x: 60,  y: 430, w: 500, h: 60, size: 30, align: "center", maxLines: 1, _yFromTop: true },
      date: { x: 230, y: 600, w: 500, h: 40, size: 25, align: "left",   maxLines: 1, _yFromTop: true }
    },

    // Headers p2–p8
    p2: { hdrName: { x: 380, y: 39, w: 400, h: 24, size: 13, align: "left", maxLines: 1, _yFromTop: true } },

    p3: {
      hdrName: { x: 380, y: 39, w: 400, h: 24, size: 13, align: "left", maxLines: 1, _yFromTop: true },

      p3Text: {
        exec1: { x: 25, y: 200, w: 620, h: 250, size: 15, align: "left", maxLines: 13, _yFromTop: true },
        exec2: { x: 25, y: 160, w: 620, h: 420, size: 15, align: "left", maxLines: 22, _yFromTop: true }
      },

      p3Q: {
        exec_q1: { x: 25, y: 620, w: 620, h: 30, size: 15, align: "left", maxLines: 2, _yFromTop: true },
        exec_q2: { x: 25, y: 660, w: 620, h: 30, size: 15, align: "left", maxLines: 2, _yFromTop: true },
        exec_q3: { x: 25, y: 700, w: 620, h: 30, size: 15, align: "left", maxLines: 2, _yFromTop: true },
        exec_q4: { x: 25, y: 740, w: 620, h: 30, size: 15, align: "left", maxLines: 2, _yFromTop: true }
      }
    },

    p4: {
      hdrName: { x: 380, y: 39, w: 400, h: 24, size: 13, align: "left", maxLines: 1, _yFromTop: true },

      p4Text: {
        ov1:   { x: 25,  y: 5,   w: 200, h: 240, size: 15, align: "left", maxLines: 25, _yFromTop: true },
        ov2:   { x: 25,  y: 150, w: 620, h: 420, size: 15, align: "left", maxLines: 23, _yFromTop: true },
        chart: { x: 250, y: 160, w: 320, h: 320, _yFromTop: true }
      },

      p4Q: {
        ov_q1: { x: 25, y: 650, w: 620, h: 40, size: 15, align: "left", maxLines: 2, _yFromTop: true },
        ov_q2: { x: 25, y: 700, w: 620, h: 40, size: 15, align: "left", maxLines: 2, _yFromTop: true }
      }
    },

    p5: {
      hdrName: { x: 380, y: 39, w: 400, h: 24, size: 13, align: "left", maxLines: 1, _yFromTop: true },

      p5Text: {
        dd1: { x: 25, y: -70, w: 620, h: 240, size: 15, align: "left", maxLines: 13, _yFromTop: true },
        dd2: { x: 25, y: -30, w: 620, h: 310, size: 15, align: "left", maxLines: 17, _yFromTop: true },
        th1: { x: 25, y: 400, w: 620, h: 160, size: 15, align: "left", maxLines: 9,  _yFromTop: true },
        th2: { x: 25, y: 480, w: 620, h: 160, size: 15, align: "left", maxLines: 9,  _yFromTop: true }
      },

      p5Q: {
        dd_q1: { x: 25, y: 310, w: 620, h: 40, size: 15, align: "left", maxLines: 2, _yFromTop: true },
        dd_q2: { x: 25, y: 340, w: 620, h: 40, size: 15, align: "left", maxLines: 2, _yFromTop: true },
        th_q1: { x: 25, y: 680, w: 620, h: 40, size: 15, align: "left", maxLines: 2, _yFromTop: true },
        th_q2: { x: 25, y: 720, w: 620, h: 40, size: 15, align: "left", maxLines: 2, _yFromTop: true }
      }
    },

    p6: {
      hdrName: { x: 380, y: 39, w: 400, h: 24, size: 13, align: "left", maxLines: 1, _yFromTop: true },

      p6WorkWith: {
        collabC: { x: 30,  y: -80, w: 270, h: 420, size: 15, align: "left", maxLines: 14, _yFromTop: true },
        collabT: { x: 320, y: -80, w: 260, h: 420, size: 15, align: "left", maxLines: 14, _yFromTop: true }
      },

      p6Q: {
        col_q1:  { x: 30,  y: 550, w: 270, h: 40, size: 15, align: "left", maxLines: 5, _yFromTop: true },
        lead_q1: { x: 320, y: 550, w: 260, h: 40, size: 15, align: "left", maxLines: 5, _yFromTop: true }
      }
    },

    p7: {
      hdrName: { x: 380, y: 39, w: 400, h: 24, size: 13, align: "left", maxLines: 1, _yFromTop: true },

      p7Actions: {
        act1: { x: 50,  y: 330, w: 440, h: 95, size: 16, align: "left", maxLines: 5, _yFromTop: true },
        act2: { x: 100, y: 470, w: 440, h: 95, size: 16, align: "left", maxLines: 5, _yFromTop: true },
        act3: { x: 50,  y: 610, w: 440, h: 95, size: 16, align: "left", maxLines: 5, _yFromTop: true }
      }
    },

    p8: { hdrName: { x: 380, y: 39, w: 400, h: 24, size: 13, align: "left", maxLines: 1, _yFromTop: true } }
  }
};

/* ───────── layout override hook (UPDATED V6.3) ───────── */
function applyLayoutOverridesFromUrl(layoutPages, url) {
  const params = url.searchParams;

  // Default: URL y-values are FROM TOP (matches your working coordinate style)
  // Optional: &L_origin=bottom to treat URL y-values as bottom-origin.
  const origin = (params.get("L_origin") || "top").toLowerCase(); // "top" | "bottom"
  const useTopOrigin = origin !== "bottom";

  const allowedProps = new Set(["x", "y", "w", "h", "size", "align", "maxLines"]);
  const applied = [];
  const ignored = [];

  const getOrCreateObj = (root, pathParts) => {
    let cur = root;

    for (let i = 0; i < pathParts.length; i++) {
      const p = pathParts[i];

      // ── V6.3.1+ enhancement:
      // If the layout already contains a key with an underscore (e.g. "exec_q1"),
      // and the incoming path arrives split ("exec","q1"), auto-join it.
      if (cur && typeof cur === "object" && i + 1 < pathParts.length) {
        const joined = `${p}_${pathParts[i + 1]}`;
        if (Object.prototype.hasOwnProperty.call(cur, joined)) {
          // Jump over the next token because we consumed it.
          i += 1;

          if (!cur[joined] || typeof cur[joined] !== "object") cur[joined] = {};
          cur = cur[joined];
          continue;
        }
      }

      if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p];
    }

    return cur;
  };

  for (const [k, rawVal] of params.entries()) {
    if (!k.startsWith("L_")) continue;

    const key = k.slice(2); // remove "L_"
    const parts = key.split("_");

    if (parts.length < 2) {
      ignored.push({ key: k, reason: "Too few parts" });
      continue;
    }

    const prop = parts[parts.length - 1];
    if (!allowedProps.has(prop)) {
      ignored.push({ key: k, reason: `Unknown prop: ${prop}` });
      continue;
    }

    const pathParts = parts.slice(0, -1);
    const target = getOrCreateObj(layoutPages, pathParts);

    let v = rawVal;

    if (prop === "x" || prop === "y" || prop === "w" || prop === "h" || prop === "size" || prop === "maxLines") {
      const num = Number(rawVal);
      if (!Number.isFinite(num)) {
        ignored.push({ key: k, reason: `Not a number: ${rawVal}` });
        continue;
      }
      v = num;
    } else if (prop === "align") {
      const a = String(rawVal).toLowerCase();
      if (!["left", "center", "right"].includes(a)) {
        ignored.push({ key: k, reason: `Bad align: ${rawVal}` });
        continue;
      }
      v = a;
    }

    target[prop] = v;

    // Mark y-origin mode when overridden via URL
    if (prop === "y") target._yFromTop = useTopOrigin;

    applied.push({
      key: k,
      path: pathParts.join("."),
      prop,
      value: v,
      yFromTop: prop === "y" ? useTopOrigin : undefined
    });
  }

  return { layout: layoutPages, applied, ignored, origin: useTopOrigin ? "top" : "bottom" };
}

/* ───────── simple wrapper drawer ───────── */
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

  const maxChars = Math.max(10, Math.floor(N(box.w, 300) / (size * 0.52)));
  const lines = splitLinesToFit(S(text), maxChars).slice(0, maxLines);
  const lh = size + 2;

  // V6.3: support top-origin y overrides
  let y = N(box.y, 0);
  if (box._yFromTop) {
    const pageH = page.getHeight();
    const h = N(box.h, 0);
    y = pageH - y - h;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let x = N(box.x, 0);

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

/* ───────── dom/second combo logic ───────── */
function computeDomAndSecondKeys({ raw, domKey, secondKey }) {
  const bands = raw?.ctrl?.bands || raw?.bands || {};
  const sumState = (prefix) =>
    N(bands[prefix+"low"]) + N(bands[prefix+"mid"]) + N(bands[prefix+"high"]) ||
    N(bands[prefix+"Low"]) + N(bands[prefix+"Mid"]) + N(bands[prefix+"High"]) ||
    0;

  let D = (S(domKey).toUpperCase() || "").slice(0,1);
  let S2 = (S(secondKey).toUpperCase() || "").slice(0,1);

  if (!D || !S2) {
    const totals = { C: sumState("C_"), T: sumState("T_"), R: sumState("R_"), L: sumState("L_") };
    const sorted = Object.entries(totals).sort((a,b)=> b[1]-a[1]);
    if (!D)  D  = sorted[0]?.[0] || "";
    if (!S2) S2 = sorted[1]?.[0] || "";
  }

  return { domKey: D, secondKey: S2, templateKey: (D && S2) ? (D + S2) : "" };
}

/* ───────── bullets ───────── */
function bulletQ(s) {
  const t = norm(winAnsiSafe(s));
  if (!t) return "";
  return t.startsWith("•") ? t : `• ${t}`;
}

/* ───────── normalise payload -> draw fields ───────── */
function normaliseInput(d) {
  const identity = okObj(d.identity) ? d.identity : {};
  const text = okObj(d.text) ? d.text : {};
  const actions = okObj(d.actions) ? d.actions : {};

  const fullName = norm(identity.fullName || d.fullName || "");
  const dateLabel = norm(identity.dateLabel || d.dateLbl || "");

  const chartUrl = norm(d.chartUrl || d.spiderChartUrl || d?.chart?.spiderUrl || "");

  const exec = norm(text.exec_summary || "");
  const ov   = norm(text.ctrl_overview || "");
  const dd   = norm(text.ctrl_deepdive || "");
  const th   = norm(text.themes || "");
  const adaptC = norm(text.adapt_with_colleagues || "");
  const adaptL = norm(text.adapt_with_leaders || "");

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

  const act1 = norm(actions.actions1 || d.Act1 || "");
  const act2 = norm(actions.actions2 || d.Act2 || "");
  const act3 = norm(actions.actions3 || d.Act3 || "");

  return {
    raw: d,
    identity: { fullName, dateLabel },

    exec_summary_para1: execA,
    exec_summary_para2: execB,

    ctrl_overview_para1: ovA,
    ctrl_overview_para2: ovB,

    ctrl_deepdive_para1: ddA,
    ctrl_deepdive_para2: ddB,

    themes_para1: thA,
    themes_para2: thB,

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

    workWith: { concealed: adaptC, triggered: adaptL },

    Act1: act1,
    Act2: act2,
    Act3: act3,

    chartUrl,
  };
}

/* ───────── fetch with timeout to avoid 504 hangs ───────── */
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

/* ───────── embed chart (remote url) ───────── */
async function embedChartIfPresent(pdfDoc, page, box, chartUrl) {
  if (!chartUrl) return;
  const imgBytes = await fetchWithTimeout(chartUrl, 6500);
  const img = await pdfDoc.embedPng(imgBytes);

  // V6.3: support top-origin y overrides
  let x = N(box.x, 0);
  let y = N(box.y, 0);
  const w = N(box.w, 0);
  const h = N(box.h, 0);

  if (box._yFromTop) {
    const pageH = page.getHeight();
    y = pageH - y - h;
  }

  page.drawImage(img, { x, y, width: w, height: h });
}

/* ───────── debug probe ───────── */
function buildProbe(P, domSecond, tplInfo, ov, templateInventory) {
  return {
    ok: true,
    where: "fill-template:OBSERVER_180:debug",
    cwd: process.cwd(),
    tplInfo: safeJson(tplInfo),
    domSecond: safeJson(domSecond),
    identity: { fullName: P.identity.fullName, dateLabel: P.identity.dateLabel },
    chart: { hasChartUrl: !!P.chartUrl, chartUrl: P.chartUrl ? P.chartUrl.slice(0, 140) : "" },
    layoutOverrides: {
      appliedCount: ov?.applied?.length || 0,
      ignoredCount: ov?.ignored?.length || 0,
      origin: ov?.origin || null
    },
    templateInventory: safeJson(templateInventory)
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

    const tplInfo = await resolveTemplateFile(safeCombo);

    const templateInventory = [];
    for (const dir of getPublicDirCandidates()) {
      const list = await listTemplatesInDir(dir);
      if (list.length) templateInventory.push({ dir, count: list.length, files: list.slice(0, 50) });
    }

    if (!tplInfo.found) {
      return res.status(500).json({
        ok: false,
        error: "No observer templates found in any /public candidate path.",
        desired: tplInfo.desired,
        candidates: tplInfo.candidates,
        cwd: process.cwd(),
        templateInventory
      });
    }

    const ov = applyLayoutOverridesFromUrl(DEFAULT_LAYOUT.pages, url);

    if (debug) {
      return res.status(200).json(buildProbe(P, domSecond, tplInfo, ov, templateInventory));
    }

    const pdfBytes = await loadTemplateBytes(tplInfo.fullPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pages = pdfDoc.getPages();
    const L = DEFAULT_LAYOUT.pages;

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
      drawTextBox(p3, font, P.exec_summary_para1, L.p3.p3Text.exec1);
      drawTextBox(p3, font, P.exec_summary_para2, L.p3.p3Text.exec2);

      drawTextBox(p3, font, P.exec_q1, L.p3.p3Q.exec_q1);
      drawTextBox(p3, font, P.exec_q2, L.p3.p3Q.exec_q2);
      drawTextBox(p3, font, P.exec_q3, L.p3.p3Q.exec_q3);
      drawTextBox(p3, font, P.exec_q4, L.p3.p3Q.exec_q4);
    }

    if (p4) {
      drawTextBox(p4, font, P.ctrl_overview_para1, L.p4.p4Text.ov1);
      drawTextBox(p4, font, P.ctrl_overview_para2, L.p4.p4Text.ov2);

      try {
        await embedChartIfPresent(pdfDoc, p4, L.p4.p4Text.chart, P.chartUrl);
      } catch (e) {
        console.warn("[fill-template:OBSERVER_180] Chart skipped:", e?.message || String(e));
      }

      drawTextBox(p4, font, P.ov_q1, L.p4.p4Q.ov_q1);
      drawTextBox(p4, font, P.ov_q2, L.p4.p4Q.ov_q2);
    }

    if (p5) {
      drawTextBox(p5, font, P.ctrl_deepdive_para1, L.p5.p5Text.dd1);
      drawTextBox(p5, font, P.ctrl_deepdive_para2, L.p5.p5Text.dd2);

      drawTextBox(p5, font, P.themes_para1, L.p5.p5Text.th1);
      drawTextBox(p5, font, P.themes_para2, L.p5.p5Text.th2);

      drawTextBox(p5, font, P.dd_q1, L.p5.p5Q.dd_q1);
      drawTextBox(p5, font, P.dd_q2, L.p5.p5Q.dd_q2);
      drawTextBox(p5, font, P.th_q1, L.p5.p5Q.th_q1);
      drawTextBox(p5, font, P.th_q2, L.p5.p5Q.th_q2);
    }

    if (p6) {
      drawTextBox(p6, font, P.workWith?.concealed, L.p6.p6WorkWith.collabC);
      drawTextBox(p6, font, P.workWith?.triggered, L.p6.p6WorkWith.collabT);

      drawTextBox(p6, font, P.col_q1,  L.p6.p6Q.col_q1);
      drawTextBox(p6, font, P.lead_q1, L.p6.p6Q.lead_q1);
    }

    if (p7) {
      drawTextBox(p7, font, P.Act1, L.p7.p7Actions.act1);
      drawTextBox(p7, font, P.Act2, L.p7.p7Actions.act2);
      drawTextBox(p7, font, P.Act3, L.p7.p7Actions.act3);
    }

    const outBytes = await pdfDoc.save();
    const outName = makeOutputFilename(P.identity.fullName, P.identity.dateLabel);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
    res.setHeader("X-Template-Used", tplInfo.file);
    res.setHeader("X-Template-Fallback", String(!!tplInfo.fallbackUsed));

    res.status(200).send(Buffer.from(outBytes));
  } catch (err) {
    console.error("[fill-template:OBSERVER_180] CRASH", err);

    const candidates = getPublicDirCandidates();
    const inv = [];
    for (const dir of candidates) {
      const list = await listTemplatesInDir(dir);
      if (list.length) inv.push({ dir, count: list.length, files: list.slice(0, 50) });
    }

    res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      cwd: process.cwd(),
      publicDirCandidates: candidates,
      templateInventory: inv,
      stack: err?.stack || null
    });
  }
}
