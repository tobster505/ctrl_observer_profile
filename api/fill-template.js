// api/fill-template.js (V2.1 – STOP HANGING: base64url decode + fetch timeouts)
export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- helpers ----------
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);

function withTimeout(ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return { controller, done: () => clearTimeout(t) };
}

async function fetchBytes(url, timeoutMs = 8000) {
  const { controller, done } = withTimeout(timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error(`Fetch failed: ${r.status} ${r.statusText}`);
    return new Uint8Array(await r.arrayBuffer());
  } finally {
    done();
  }
}

// base64url -> json
function decodeBase64UrlToJson(dataB64url) {
  // Convert URL-safe base64 back to standard base64
  const b64 = String(dataB64url || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(String(dataB64url || "").length / 4) * 4, "=");

  const jsonStr = Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(jsonStr);
}

// ---------- minimal draw helper (keep yours if already present) ----------
function drawText(page, font, text, x, y, size = 12) {
  page.drawText(String(text || ""), { x, y, size, font, color: rgb(0, 0, 0) });
}

// ---------- handler ----------
export default async function handler(req) {
  try {
    const url = req.url || "";
    const u = new URL(url, "http://localhost");

    const tplRaw = u.searchParams.get("tpl") || u.searchParams.get("template") || "";
    if (!tplRaw) return new Response(JSON.stringify({ ok: false, error: "Missing tpl" }), { status: 400 });

    const dataRaw = u.searchParams.get("data") || "";
    if (!dataRaw) return new Response(JSON.stringify({ ok: false, error: "Missing data" }), { status: 400 });

    // tpl must be absolute
    if (!/^https?:\/\//i.test(tplRaw)) {
      return new Response(JSON.stringify({ ok: false, error: "tpl must be an absolute URL" }), { status: 400 });
    }

    // Decode base64url safely
    let data = {};
    try {
      data = decodeBase64UrlToJson(dataRaw);
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "Bad data JSON (base64url decode failed)" }), { status: 400 });
    }

    // Fetch template with timeout (prevents hanging)
    const pdfBytes = await fetchBytes(tplRaw, 8000);
    const pdf = await PDFDocument.load(pdfBytes);
    const Helv = await pdf.embedFont(StandardFonts.Helvetica);

    const pages = pdf.getPages();
    const page1 = pages[0];

    // (Keep your real overlay logic here — this is just a proof it returns fast)
    if (page1) {
      drawText(page1, Helv, data?.identity?.fullName || "Name missing", 50, page1.getHeight() - 60, 14);
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
    // If AbortController fires, this prevents “hang forever”
    return new Response(
      JSON.stringify({ ok: false, error: String(err?.message || err) }),
      { status: 500 }
    );
  }
}
