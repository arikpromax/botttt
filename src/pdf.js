// PDF із фото без бібліотек: JPEG вкладається в PDF як є (DCTDecode), кожне фото — окрема сторінка A4.

const A4 = [595.28, 841.89]; // пункти

// Розміри й кількість кольорових каналів JPEG — з маркера SOF; null, якщо це не JPEG.
export function jpegInfo(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let p = 2; p + 9 < bytes.length;) {
    if (bytes[p] !== 0xff) return null;
    const marker = bytes[p + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    const length = (bytes[p + 2] << 8) | bytes[p + 3];
    // SOF0–SOF15, крім DHT (C4), JPG (C8) і DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: (bytes[p + 5] << 8) | bytes[p + 6],
        width: (bytes[p + 7] << 8) | bytes[p + 8],
        components: bytes[p + 9],
      };
    }
    p += 2 + length;
  }
  return null;
}

const COLOR = { 1: "/DeviceGray", 3: "/DeviceRGB" };
export const pdfReady = (info) => Boolean(info && COLOR[info.components]);

// jpegs — масив Uint8Array (JPEG у відтінках сірого чи RGB) → Uint8Array PDF.
export function imagesToPdf(jpegs) {
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (part) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n, body, stream) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"); // двійковий коментар (байти ≥ 128), щоб програми не вважали файл текстом
  const kids = jpegs.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${jpegs.length} >>`);

  jpegs.forEach((jpeg, i) => {
    const info = jpegInfo(jpeg);
    if (!pdfReady(info)) throw new Error("для PDF потрібен JPEG у RGB або відтінках сірого");
    const [pw, ph] = info.width > info.height ? [A4[1], A4[0]] : A4;
    const scale = Math.min(pw / info.width, ph / info.height);
    const w = info.width * scale;
    const h = info.height * scale;
    const draw = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${((pw - w) / 2).toFixed(2)} ${((ph - h) / 2).toFixed(2)} cm /Im0 Do Q`;
    const n = 3 + i * 3;
    object(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] ` +
      `/Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    object(n + 1, `<< /Length ${draw.length} >>`, encoder.encode(draw));
    object(n + 2, `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} ` +
      `/ColorSpace ${COLOR[info.components]} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  });

  const count = 3 + jpegs.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
