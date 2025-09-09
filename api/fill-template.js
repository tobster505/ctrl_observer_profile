// /api/fill-template.js
import path from "node:path";
import fs from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const config = {
  api: { bodyParser: true } // allow JSON POST body
};

export default async function handler(req, res) {
  try {
    const isPost = req.method === "POST";
    const src = isPost ? (req.body || {}) : (req.query || {});

    // payload (keep keys short & stable)
    const {
      name = "—",
      dominant = "—",
      titleBand = "—",
      pullText = "—",
      reportDate = ""
    } = src;

    // load template
    const templatePath = path.join(
      process.cwd(),
      "public",
      "CTRL_Observer_Assessment_Profile_template_V1.pdf"
    );
    const templateBytes = await fs.readFile(templatePath);

    const pdfDoc = await PDFDocument.load(templateBytes);
    const [page] = pdfDoc.getPages();
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Simple stamping positions (adjust to your template)
    const W = page.getWidth();
    const H = page.getHeight();

    // Header
    page.drawText(name, {
      x: 72,
      y: H - 72,
      size: 14,
      font: helvBold,
      color: rgb(0, 0, 0)
    });

    page.drawText(reportDate, {
      x: W - 200,
      y: H - 72,
      size: 10,
      font: helv,
      color: rgb(0, 0, 0)
    });

    // Core fields
    page.drawText(`Dominant: ${dominant}`, {
      x: 72,
      y: H - 110,
      size: 12,
      font: helvBold
    });

    page.drawText(`Title band: ${titleBand}`, {
      x: 72,
      y: H - 130,
      size: 12,
      font: helv
    });

    // Pull text (wrap basic)
    const wrap = (text, maxChars = 90) => {
      const out = [];
      let line = "";
      for (const word of String(text).split(/\s+/)) {
        if ((line + " " + word).trim().length > maxChars) {
          out.push(line.trim());
          line = word;
        } else {
          line += " " + word;
        }
      }
      if (line.trim()) out.push(line.trim());
      return out;
    };

    const pullLines = wrap(pullText, 95);
    let y = H - 170;
    page.drawText("Directional pull:", { x: 72, y, size: 12, font: helvBold });
    y -= 18;
    for (const ln of pullLines) {
      page.drawText(ln, { x: 72, y, size: 11, font: helv });
      y -= 14;
    }

    const pdfBytes = await pdfDoc.save();

    res.setHeader("content-type", "application/pdf");
    res.setHeader(
      "content-disposition",
      'inline; filename="CTRL_Observer_Profile.pdf"'
    );
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}
