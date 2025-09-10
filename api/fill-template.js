// fill-template.js — renderer-side, matches Build_PDF_Link_for_Observer_SAFE
(function () {
  // ---- helpers -------------------------------------------------------------
  const qs = new URLSearchParams(location.search);
  const el = sel => document.querySelector(sel);
  const text = (sel, v) => { const n = el(sel); if (n) n.textContent = (v ?? "—"); };
  const safe = s => String(s ?? "");

  function decodePayload(param) {
    if (!param) return null;

    // try base64url -> JSON
    try {
      const base64 = param.replace(/-/g, "+").replace(/_/g, "/");
      const json = atob(base64);
      return JSON.parse(json);
    } catch (_) {}

    // try URI-encoded JSON
    try { return JSON.parse(decodeURIComponent(param)); } catch (_) {}

    // try raw JSON
    try { return JSON.parse(param); } catch (_) {}

    return null;
  }

  // ---- read ----------------------------------------------------------------
  const payload = decodePayload(qs.get("payload")) || {};
  const person  = payload.person || {};
  const spider  = payload.spider || {};
  const pattern = payload.pattern || {};
  const themes  = payload.themes || {};

  // ---- bind to DOM (adjust selectors to your HTML template) ----------------
  text("[data-id='fullName']",       person.fullName);
  text("[data-id='preferredName']",  person.preferredName);
  text("[data-id='dateLbl']",        payload.dateLbl);
  text("[data-id='dom6Key']",        payload.dom6Key);
  text("[data-id='dom6Label']",      payload.dom6Label);

  text("[data-id='patternLabel']",   pattern.label);
  text("[data-id='themePairKey']",   themes.pairKey);

  // Optional: spider chart <img>
  const img = el("[data-id='spiderChart']");
  if (img && spider.chartUrl) img.src = safe(spider.chartUrl);

  // ---- show raw JSON for debugging (optional) ------------------------------
  const pre = el("[data-id='debugJson']");
  if (pre) pre.textContent = JSON.stringify(payload, null, 2);

  // ---- optional: trigger a client-side download of the JSON (for testing) --
  const dl = el("[data-id='download-json']");
  if (dl) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    dl.href = URL.createObjectURL(blob);
    dl.download = (person.fullName ? person.fullName.replace(/\s+/g, "_") : "Observer") + "_payload.json";
  }

  // If you use a client-side PDF tool (e.g., jsPDF/print), call it here.
  // window.print(); // <- if your HTML is already styled for printing
})();
