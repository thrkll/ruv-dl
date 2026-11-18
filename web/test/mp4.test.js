// Run with: node --test web/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMp4Writer, UnsupportedError } from '../mp4.js';
import { makeInit, makeFragment, readMp4, collector, mp4box, cat, NON_SYNC } from './fixtures.js';

const VIDEO = { id: 1, handler: 'vide', timescale: 90000, width: 320, height: 180 };
const AUDIO = { id: 2, handler: 'soun', timescale: 48000 };

// n video samples of 3600 ticks (25 fps); the first is a key frame
const frames = (n, { size = 10, cto = 0, key = [0] } = {}) => Array.from({ length: n }, (_, i) =>
  ({ dur: 3600, size: size + i, flags: key.includes(i) ? 0 : NON_SYNC, cto }));
const aac = (n, size = 7) => Array.from({ length: n }, () => ({ dur: 1024, size, flags: 0 }));

async function write(build, opts) {
  const out = collector();
  const w = createMp4Writer({ write: out.write, ...opts });
  await build(w);
  const result = await w.finish();
  return { mp4: readMp4(out.bytes(), opts?.startOffset), raw: out.bytes(), result };
}

const fill = (n, v) => new Uint8Array(n).fill(v & 255);

test('layout: ftyp, one mdat per fragment, moov last; chunk offsets point at the samples', async () => {
  const { mp4, raw } = await write(async w => {
    const v = w.addTrack(makeInit([VIDEO]));
    const a = w.addTrack(makeInit([AUDIO]));
    await w.addFragment(v, makeFragment([{ trackId: 1, tfdt: 0, samples: frames(3), fillBase: 10 }]));
    await w.addFragment(a, makeFragment([{ trackId: 2, tfdt: 0, samples: aac(4), fillBase: 100 }]));
    await w.addFragment(v, makeFragment([{ trackId: 1, tfdt: 10800, samples: frames(2), fillBase: 20 }]));
  });
  assert.deepEqual(mp4.top, ['ftyp', 'mdat', 'mdat', 'mdat', 'moov']);
  assert.equal(String.fromCharCode(...raw.subarray(8, 12)), 'isom');
  const [v, a] = mp4.tracks;
  assert.deepEqual(v.samples.map(s => s.bytes), [fill(10, 10), fill(11, 11), fill(12, 12), fill(10, 20), fill(11, 21)]);
  assert.deepEqual(a.samples.map(s => s.bytes[0]), [100, 101, 102, 103]);
  assert.deepEqual(v.stts, [[5, 3600]]);
  assert.deepEqual(v.stsz, [10, 11, 12, 10, 11]);
  assert.deepEqual(v.stsc, [[1, 3, 1], [2, 2, 1]]);
  assert.equal(v.offsets.length, 2);
  assert.equal(v.offsetBox, 'stco');
  assert.deepEqual(a.stts, [[4, 1024]]);
  assert.deepEqual(a.stsc, [[1, 4, 1]]);
  // Headers
  assert.equal(mp4.mvhd.timescale, 1000);
  assert.equal(mp4.mvhd.next, 3);
  assert.deepEqual(mp4.tracks.map(t => t.tkhd.id), [1, 2]);
  assert.deepEqual(mp4.tracks.map(t => t.handler), ['vide', 'soun']);
  assert.equal(v.mdhd.duration, 5 * 3600);
  assert.equal(v.mdhd.timescale, 90000);
  assert.equal(a.mdhd.duration, 4 * 1024);
  assert.deepEqual([v.tkhd.width, v.tkhd.height], [320, 180]);
  assert.deepEqual([v.tkhd.volume, a.tkhd.volume], [0, 0x100]);
  assert.equal(v.tkhd.duration, 200);
  assert.equal(mp4.mvhd.duration, 200);
  // stsd copied as is
  assert.equal(new TextDecoder().decode(v.stsd.subarray(16)), 'vide');
});

test('ctts only when needed, v1 when negative; stss for video only', async () => {
  const { mp4 } = await write(async w => {
    const v = w.addTrack(makeInit([VIDEO, AUDIO]));
    await w.addFragment(v, makeFragment([
      { trackId: 1, tfdt: 0, samples: frames(4, { key: [0, 2] }).map((s, i) => ({ ...s, cto: [7200, 0, 7200, 0][i] })) },
      { trackId: 2, tfdt: 0, samples: aac(3).map(s => ({ ...s, flags: NON_SYNC })) },
    ]));
  });
  const [v, a] = mp4.tracks;
  assert.deepEqual(v.ctts, { version: 0, entries: [[1, 7200], [1, 0], [1, 7200], [1, 0]] });
  assert.deepEqual(v.stss, [1, 3]);
  assert.equal(a.ctts, null);
  assert.equal(a.stss, null);  // never for audio, whatever the flags say

  const neg = await write(async w => {
    const s = w.addTrack(makeInit([VIDEO]));
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 0, version: 1,
      samples: frames(3, { key: [0, 1, 2] }).map((x, i) => ({ ...x, cto: [-3600, 0, 3600][i] })) }]));
  });
  assert.deepEqual(neg.mp4.tracks[0].ctts, { version: 1, entries: [[1, -3600], [1, 0], [1, 3600]] });
  assert.equal(neg.mp4.tracks[0].stss, null);  // every sample is sync
});

test('elst: empty edit for a track that starts later, media_time = first composition offset', async () => {
  // Blæja: video PTS 1.48 s (DTS 1.40 s), audio PTS 1.40 s
  const { mp4, result } = await write(async w => {
    const v = w.addTrack(makeInit([{ ...VIDEO, id: 256 }]), 'vide');
    const a = w.addTrack(makeInit([{ ...AUDIO, id: 256 }]), 'soun');
    await w.addFragment(v, makeFragment([{ trackId: 256, tfdt: 126000, samples: frames(50, { cto: 7200 }) }]));
    await w.addFragment(a, makeFragment([{ trackId: 256, tfdt: 67200, samples: aac(94) }]));
  });
  const [v, a] = mp4.tracks;
  // 50 frames = 180000 ticks, minus the 7200 offset = 1920 ms shown
  assert.deepEqual(v.elst, [[80, -1], [1920, 7200]]);
  assert.deepEqual(a.elst, [[2005, 0]]);  // 94 × 1024 / 48000 = 2.005 s
  assert.equal(v.tkhd.duration, 2000);
  assert.equal(mp4.mvhd.duration, 2005);
  assert.deepEqual(result.tracks.map(t => t.delay), [0.08, 0]);
});

test('tfhd and trex defaults, first_sample_flags, base_data_offset', async () => {
  const init = makeInit([{ ...VIDEO, trex: { dur: 3600, size: 5, flags: NON_SYNC } }]);
  const { mp4 } = await write(async w => {
    const s = w.addTrack(init);
    // trex defaults only; first_sample_flags marks the key frame
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 0, fields: '', firstFlags: 0,
      samples: [{ size: 5 }, { size: 5 }, { size: 5 }] }]));
    // tfhd defaults override trex; sizes per sample; absolute base_data_offset after a styp
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 10800, fields: 's', absoluteBase: true,
      defaults: { dur: 1800, flags: 0 }, samples: [{ size: 3 }, { size: 4 }] }],
      { prefix: mp4box('styp', new Uint8Array(8)) }));
  });
  const t = mp4.tracks[0];
  assert.deepEqual(t.stts, [[3, 3600], [2, 1800]]);
  assert.deepEqual(t.stsz, [5, 5, 5, 3, 4]);
  assert.deepEqual(t.stss, [1, 4, 5]);
  assert.deepEqual(t.samples.map(s => s.bytes[0]), [50, 51, 52, 50, 51]);
  assert.deepEqual(mp4.top, ['ftyp', 'mdat', 'mdat', 'moov']);
});

test('muxed fragments: one source, tracks split by ID, two trafs sharing one mdat', async () => {
  const { mp4 } = await write(async w => {
    const s = w.addTrack(makeInit([VIDEO, AUDIO]));
    await w.addFragment(s, cat([
      makeFragment([{ trackId: 1, tfdt: 0, samples: frames(2) }]),
      makeFragment([{ trackId: 2, tfdt: 0, samples: aac(3) }]),
    ]));
    await w.addFragment(s, makeFragment([
      { trackId: 1, tfdt: 7200, samples: frames(1), fillBase: 70 },
      { trackId: 2, tfdt: 3072, samples: aac(2), fillBase: 80 },
    ]));
  });
  assert.deepEqual(mp4.top, ['ftyp', 'mdat', 'mdat', 'mdat', 'moov']);
  const [v, a] = mp4.tracks;
  assert.deepEqual(v.samples.map(s => s.bytes[0]), [50, 51, 70]);
  assert.deepEqual(a.samples.map(s => s.bytes[0]), [100, 101, 102, 80, 81]);
  assert.deepEqual(a.stts, [[5, 1024]]);
});

test('overlap: repeated samples are left out and the chunk starts after their bytes', async () => {
  const { mp4, result } = await write(async w => {
    const s = w.addTrack(makeInit([VIDEO]));
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 0, samples: frames(10), fillBase: 0 }]));
    // mux.js GOP fusion: the last 4 frames again (identical), then 5 new ones
    const again = frames(10).slice(6).map(x => ({ ...x, flags: NON_SYNC }));
    again[0].flags = 0;
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 6 * 3600,
      samples: [...again, ...frames(5, { key: [] })], fillBase: 200 }]));
  });
  const t = mp4.tracks[0];
  assert.equal(t.samples.length, 15);
  assert.deepEqual(t.stts, [[15, 3600]]);
  assert.deepEqual(t.stsc, [[1, 10, 1], [2, 5, 1]]);
  // Kept samples are the five new ones: fill bytes 204..208, sizes 10..14
  assert.deepEqual(t.samples.slice(10).map(s => [s.bytes[0], s.bytes.length]),
    [[204, 10], [205, 11], [206, 12], [207, 13], [208, 14]]);
  assert.deepEqual(t.stss, [1]);  // the first kept frame is not marked sync
  assert.deepEqual(result.tracks[0], { ...result.tracks[0], trims: 1, trimSeconds: 4 * 3600 / 90000, gaps: 0 });
});

test('overlap that is not on a sample boundary leaves a small gap, closed on the previous sample', async () => {
  const { mp4 } = await write(async w => {
    const s = w.addTrack(makeInit([AUDIO]));
    await w.addFragment(s, makeFragment([{ trackId: 2, tfdt: 0, samples: aac(4) }]));
    await w.addFragment(s, makeFragment([{ trackId: 2, tfdt: 4096 - 1500, samples: aac(4) }]));
  });
  const t = mp4.tracks[0];
  // Samples at 2596 and 3620 are dropped; 4644 is kept, 548 ticks after 4096
  assert.deepEqual(t.stts, [[3, 1024], [1, 1024 + 548], [2, 1024]]);
  assert.equal(t.samples.length, 6);
});

test('gap: the previous fragment\'s last sample is lengthened', async () => {
  const { mp4, result } = await write(async w => {
    const s = w.addTrack(makeInit([VIDEO]));
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 0, samples: frames(3) }]));
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 10800 + 900, samples: frames(2) }]));
  });
  assert.deepEqual(mp4.tracks[0].stts, [[2, 3600], [1, 4500], [2, 3600]]);
  assert.equal(result.tracks[0].gaps, 1);
});

test('limits: a single gap over 1 s, or an overlap longer than the fragment', async () => {
  const run = async second => {
    const w = createMp4Writer({ write: async () => {} });
    const s = w.addTrack(makeInit([VIDEO]));
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 900000, samples: frames(25) }]));
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: second, samples: frames(25) }]));
  };
  await assert.rejects(run(990000 + 90001), UnsupportedError);   // 1.00001 s gap
  await run(990000 + 90000);                                     // exactly 1 s is fine
  await assert.rejects(run(990000 - 90000 - 1), UnsupportedError); // overlap longer than 1 s fragment
  await run(990000 - 90000);                                     // whole fragment repeated: dropped
});

test('co64 once chunk offsets pass 2^32', async () => {
  const startOffset = 2 ** 32 - 50;  // first chunk just below, second just above
  const { mp4 } = await write(async w => {
    const s = w.addTrack(makeInit([VIDEO]));
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 0, samples: frames(3), fillBase: 1 }]));
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 10800, samples: frames(3), fillBase: 9 }]));
  }, { startOffset });
  const t = mp4.tracks[0];
  assert.equal(t.offsetBox, 'co64');
  assert.ok(t.offsets[1] > 2 ** 32);
  assert.ok(t.offsets[0] < 2 ** 32);
  assert.deepEqual(t.samples.map(s => s.bytes[0]), [1, 2, 3, 9, 10, 11]);
});

test('new codec setup partway through: a second sample description; other changes are refused', async () => {
  const first = makeInit([{ ...VIDEO, stsdTag: 'sps1' }]);
  const second = makeInit([{ ...VIDEO, stsdTag: 'sps2' }]);
  const { mp4, result } = await write(async w => {
    const s = w.addTrack(first);
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 0, samples: frames(2) }]), first);
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 7200, samples: frames(2) }]), makeInit([{ ...VIDEO, stsdTag: 'sps1' }]));
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 14400, samples: frames(2) }]), second);
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 21600, samples: frames(2) }]), second);
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 28800, samples: frames(2) }]), first);  // back again: reused
  });
  const t = mp4.tracks[0];
  assert.equal(t.stsdCount, 2);
  assert.equal(new TextDecoder().decode(t.stsd.subarray(16)), 'sps1sps2');
  assert.deepEqual(t.stsc, [[1, 2, 1], [3, 2, 2], [5, 2, 1]]);
  assert.equal(result.tracks[0].descriptions, 2);

  // Picture size or timescale changes are still refused
  for (const changed of [{ ...VIDEO, width: 640 }, { ...VIDEO, timescale: 25000 }, { ...VIDEO, id: 9 }]) {
    const w = createMp4Writer({ write: async () => {} });
    const s = w.addTrack(makeInit([VIDEO]));
    await w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 0, samples: frames(2) }]));
    await assert.rejects(
      w.addFragment(s, makeFragment([{ trackId: 1, tfdt: 7200, samples: frames(2) }]), makeInit([changed])),
      UnsupportedError);
  }
});

test('errors: no matching track, nothing written, broken boxes', async () => {
  const w = createMp4Writer({ write: async () => {} });
  assert.throws(() => w.addTrack(makeInit([AUDIO]), 'vide'), UnsupportedError);
  await assert.rejects(w.finish(), UnsupportedError);

  const w2 = createMp4Writer({ write: async () => {} });
  const s = w2.addTrack(makeInit([VIDEO]));
  const frag = makeFragment([{ trackId: 1, tfdt: 0, samples: frames(2) }]);
  await assert.rejects(w2.addFragment(s, frag.subarray(0, frag.length - 3)), UnsupportedError);
});
