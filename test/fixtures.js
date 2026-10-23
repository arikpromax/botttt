// Штучні медіафайли для тестів: MP4 з відео- і звуковою доріжкою зі справжніми таблицями семплів;
// читання QR-коду з PNG (1 біт) через jsQR.
import jsQR from "jsqr";

// Байти з InputFile grammY (у тестах файл не відправляється в Telegram).
export async function readInputFile(file) {
  const raw = await file.toRaw();
  if (raw instanceof Uint8Array) return raw;
  const chunks = [];
  for await (const chunk of raw) chunks.push(chunk);
  return concat(chunks);
}

export async function decodeQrPng(png) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const size = view.getUint32(16);
  const idat = [];
  for (let p = 8; p < png.length;) {
    const len = view.getUint32(p);
    if (String.fromCharCode(...png.subarray(p + 4, p + 8)) === "IDAT") idat.push(png.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  const rowBytes = Math.ceil(size / 8);
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = ((raw[y * (rowBytes + 1) + 1 + (x >> 3)] >> (7 - (x & 7))) & 1) * 255;
      rgba.set([c, c, c, 255], (y * size + x) * 4);
    }
  }
  return jsQR(rgba, size, size)?.data ?? null;
}

const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const u16 = (n) => Uint8Array.of(n >> 8, n & 255);
export const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const box = (type, ...parts) => concat([u32(8 + parts.reduce((n, p) => n + p.length, 0)), ascii(type), ...parts]);
const full = (type, ...parts) => box(type, new Uint8Array(4), ...parts); // версія 0, прапорці 0

// samples — масив Uint8Array; perChunk — скільки семплів у кожному чанку; offsets — зсуви чанків у файлі.
function trak({ id, handler, entry, timescale, duration, movieDuration, samples, perChunk, offsets }) {
  const stsc = []; // серії: [перший чанк, семплів у чанку]
  perChunk.forEach((n, i) => { if (!stsc.length || stsc.at(-1)[1] !== n) stsc.push([i + 1, n]); });
  const stbl = box("stbl",
    full("stsd", u32(1), entry),
    full("stts", u32(1), u32(samples.length), u32(1024)),
    full("stsc", u32(stsc.length), ...stsc.map(([first, n]) => concat([u32(first), u32(n), u32(1)]))),
    full("stsz", u32(0), u32(samples.length), ...samples.map((s) => u32(s.length))),
    full("stco", u32(offsets.length), ...offsets.map(u32)));
  return box("trak",
    full("tkhd", u32(0), u32(0), u32(id), u32(0), u32(movieDuration), new Uint8Array(60)),
    box("mdia",
      full("mdhd", u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)),
      full("hdlr", u32(0), ascii(handler), new Uint8Array(12), Uint8Array.of(0)),
      box("minf", full(handler === "soun" ? "smhd" : "vmhd", new Uint8Array(4)), stbl)));
}

const esds = (kbps) => full("esds", Uint8Array.of(0x03, 0x19, 0x00, 0x01, 0x00, 0x04, 0x11, 0x40, 0x15, 0, 0, 0),
  u32(kbps * 1000), u32(kbps * 1000));

// MP4: відео (3 семпли, чанки 2+1) і звук (5 семплів, чанки 3+2), чанки перемежовані в mdat.
// → { bytes, audioChunks: [Uint8Array] } — що має опинитися в M4A.
export function sampleVideo({ withAudio = true, codec = "mp4a" } = {}) {
  const fill = (n, v) => new Uint8Array(n).fill(v);
  const video = [fill(100, 0x11), fill(120, 0x12), fill(90, 0x13)];
  const audio = [fill(10, 0xa1), fill(11, 0xa2), fill(12, 0xa3), fill(13, 0xa4), fill(14, 0xa5)];
  const layout = [["v", [0, 1]], ...(withAudio ? [["a", [0, 1, 2]]] : []), ["v", [2]], ...(withAudio ? [["a", [3, 4]]] : [])];

  const build = (start) => {
    const offsets = { v: [], a: [] };
    let at = start;
    for (const [kind, ids] of layout) {
      offsets[kind].push(at);
      at += ids.reduce((n, i) => n + (kind === "v" ? video : audio)[i].length, 0);
    }
    const traks = [trak({ id: 1, handler: "vide", entry: box("avc1", new Uint8Array(78)), timescale: 30, duration: 90,
      movieDuration: 3000, samples: video, perChunk: [2, 1], offsets: offsets.v })];
    if (withAudio) {
      traks.push(trak({ id: 2, handler: "soun", entry: box(codec, new Uint8Array(28), esds(128)), timescale: 44100,
        duration: 44100 * 3, movieDuration: 2900, samples: audio, perChunk: [3, 2], offsets: offsets.a }));
    }
    return box("moov", full("mvhd", u32(0), u32(0), u32(1000), u32(3000), new Uint8Array(80)), ...traks);
  };

  const ftyp = box("ftyp", ascii("isom"), u32(0x200), ascii("isom"), ascii("mp42"));
  const moovSize = build(0).length;
  const moov = build(ftyp.length + moovSize + 8);
  const data = layout.flatMap(([kind, ids]) => ids.map((i) => (kind === "v" ? video : audio)[i]));
  const mdat = box("mdat", ...data);
  return {
    bytes: concat([ftyp, moov, mdat]),
    audioChunks: [concat(audio.slice(0, 3)), concat(audio.slice(3))],
  };
}
