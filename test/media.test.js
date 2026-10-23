import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NoAudioError, UnsupportedVideoError, extractAudio } from "../src/audio.js";
import { audioKbps } from "../src/mp4.js";
import { imagesToPdf, jpegInfo } from "../src/pdf.js";
import { concat, sampleVideo } from "./fixtures.js";
import { fakeJpeg } from "./harness.js";

const ascii = (bytes, from, to) => String.fromCharCode(...bytes.subarray(from, to));

// Бокси верхнього рівня та всередині moov / trak.
function boxes(bytes, start = 0, end = bytes.length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let p = start; p + 8 <= end;) {
    const size = view.getUint32(p);
    out.push({ type: ascii(bytes, p + 4, p + 8), p, end: p + size });
    p += size;
  }
  return out;
}
const inside = (bytes, b) => boxes(bytes, b.p + 8, b.end);

describe("звук із відео", () => {
  it("складає M4A лише зі звуковою доріжкою, байти звуку на своїх місцях", () => {
    const video = sampleVideo();
    const audio = extractAudio(video.bytes);
    assert.equal(audio.codec, "mp4a");
    assert.equal(audio.duration, 3);

    const out = audio.bytes;
    const top = boxes(out);
    assert.deepEqual(top.map((b) => b.type), ["ftyp", "moov", "mdat"]);
    assert.equal(ascii(out, 8, 12), "M4A ");
    const moov = inside(out, top[1]);
    assert.deepEqual(moov.map((b) => b.type), ["mvhd", "trak"]);
    assert.equal(new DataView(out.buffer).getUint32(moov[0].p + 24), 2900); // тривалість — як у звуку

    // Нові зсуви чанків вказують на ті самі байти звуку, що були у відео.
    const stbl = inside(out, inside(out, inside(out, inside(out, moov[1]).find((b) => b.type === "mdia")).find((b) => b.type === "minf")).find((b) => b.type === "stbl"));
    const stco = stbl.find((b) => b.type === "stco");
    const view = new DataView(out.buffer);
    const offsets = [view.getUint32(stco.p + 16), view.getUint32(stco.p + 20)];
    assert.deepEqual(out.subarray(offsets[0], offsets[0] + 33), video.audioChunks[0]);
    assert.deepEqual(out.subarray(offsets[1], offsets[1] + 27), video.audioChunks[1]);
    assert.equal(top[2].end, out.length);
    assert.deepEqual(out.subarray(top[2].p + 8), concat(video.audioChunks)); // у mdat лише звук

    assert.equal(audioKbps(out), 128); // файл читається як звичайний MP4 зі звуком
  });

  it("каже, якщо звуку немає або формат не той", () => {
    assert.throws(() => extractAudio(sampleVideo({ withAudio: false }).bytes), NoAudioError);
    assert.throws(() => extractAudio(sampleVideo({ codec: "Opus" }).bytes), UnsupportedVideoError);
    assert.throws(() => extractAudio(new Uint8Array(64)), UnsupportedVideoError);
  });
});

describe("PDF із фото", () => {
  it("читає розміри JPEG", () => {
    assert.deepEqual(jpegInfo(fakeJpeg(1200, 900)), { width: 1200, height: 900, components: 3 });
    assert.equal(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
  });

  it("збирає PDF зі сторінкою на кожне фото й правильною таблицею xref", () => {
    const pdf = imagesToPdf([fakeJpeg(800, 1200), fakeJpeg(1600, 900)]);
    const text = new TextDecoder("latin1").decode(pdf);
    assert.ok(text.startsWith("%PDF-1.4"));
    assert.match(text, /\/Count 2/);
    assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/); // книжкова
    assert.match(text, /\/MediaBox \[0 0 841\.89 595\.28\]/); // альбомна
    const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
    assert.equal(text.slice(xref, xref + 4), "xref");
    const entries = text.slice(xref).split("\n").slice(3, 3 + 8);
    entries.forEach((line, i) => {
      const at = Number(line.slice(0, 10));
      assert.equal(text.slice(at, at + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`);
    });
  });

  it("не приймає не-JPEG", () => {
    assert.throws(() => imagesToPdf([new Uint8Array(16)]), /JPEG/);
  });
});
