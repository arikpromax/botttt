// QR-код із тексту чи посилання → картинка PNG. Сам код рахує бібліотека qrcode-generator (MIT),
// а PNG складаємо самі: 1 біт на піксель і стиснення вбудованим CompressionStream — мало роботи процесора.
import qrcode from "qrcode-generator";

// UTF-8, щоб кирилиця та емодзі читались правильно (бібліотека за замовчуванням бере лише латиницю).
qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));

// До 300 байт (≈300 латинських чи ≈150 українських символів) код рахується за ~6 мс — у межах 10 мс процесора
// безкоштовного Cloudflare; густіші коди ще й погано сканує камера телефона.
export const QR_MAX_BYTES = 300;
const TARGET_PX = 1000;
const QUIET = 4; // біле поле навколо коду, у модулях

export class TooLongError extends Error {}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// → { png: Uint8Array, modules, size } або TooLongError.
export async function makeQr(text) {
  if (new TextEncoder().encode(text).length > QR_MAX_BYTES) throw new TooLongError();
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();

  const modules = qr.getModuleCount();
  const scale = Math.max(4, Math.floor(TARGET_PX / (modules + QUIET * 2)));
  const size = (modules + QUIET * 2) * scale;
  const rowBytes = Math.ceil(size / 8);

  // Рядок PNG: байт фільтра (0) і біти пікселів (1 — білий, 0 — чорний для градацій сірого 1 біт).
  const raw = new Uint8Array((rowBytes + 1) * size);
  const line = new Uint8Array(rowBytes);
  for (let r = 0; r < modules + QUIET * 2; r++) {
    line.fill(0xff);
    const qrRow = r - QUIET;
    if (qrRow >= 0 && qrRow < modules) {
      for (let c = 0; c < modules; c++) {
        if (!qr.isDark(qrRow, c)) continue;
        for (let x = (c + QUIET) * scale, end = x + scale; x < end; x++) line[x >> 3] &= ~(0x80 >> (x & 7));
      }
    }
    for (let y = r * scale, end = y + scale; y < end; y++) raw.set(line, y * (rowBytes + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr.set([1, 0, 0, 0, 0], 8); // 1 біт, градації сірого, стиснення, фільтр, без черезрядковості
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", ihdr),
    chunk("IDAT", await deflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return { png, modules, size };
}
