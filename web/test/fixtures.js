// Small fragmented-MP4 builders and a regular-MP4 reader for the tests.
// (No tests here; node --test loads it and finds none.)

const str = s => Uint8Array.from(s, c => c.charCodeAt(0));
const be = (v, n = 4) => {
  const a = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--) { a[i] = v % 256; v = Math.floor(v / 256); }
  return a;
};
const i32 = v => be(v >>> 0);
export const cat = parts => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
export const mp4box = (type, ...parts) => {
  const body = cat(parts);
  return cat([be(8 + body.length), str(type), body]);
};
const fullbox = (type, version, flags, ...parts) => mp4box(type, Uint8Array.of(version), be(flags, 3), ...parts);
const zeros = n => new Uint8Array(n);

// Init segment. tracks: [{ id, handler, timescale = 90000, width, height, trex, stsdTag }]
// stsdTag goes into the (fake) stsd so tests can tell sample descriptions apart.
export function makeInit(tracks) {
  return cat([
    mp4box('ftyp', str('isom'), zeros(4)),
    mp4box('moov',
      fullbox('mvhd', 0, 0, zeros(8), be(1000), be(0xffffffff), zeros(76), be(tracks.length + 1)),
      ...tracks.map(t => mp4box('trak',
        fullbox('tkhd', 0, 3, zeros(8), be(t.id), zeros(4), be(0xffffffff), zeros(52),
          be((t.width || 0) * 65536), be((t.height || 0) * 65536)),
        mp4box('mdia',
          fullbox('mdhd', 0, 0, zeros(8), be(t.timescale || 90000), be(0xffffffff), be(0x55c4, 2), zeros(2)),
          fullbox('hdlr', 0, 0, zeros(4), str(t.handler), zeros(12), str('x\0')),
          mp4box('minf', mp4box('stbl', fullbox('stsd', 0, 0, be(1), str(t.stsdTag || t.handler))))))),
      mp4box('mvex', ...tracks.map(t => fullbox('trex', 0, 0, be(t.id), be(1),
        be(t.trex?.dur || 0), be(t.trex?.size || 0), be(t.trex?.flags || 0))))),
  ]);
}

export const NON_SYNC = 0x10000;

// Sample bytes: every byte of sample i of a traf is (fillBase + i) & 255
// (or traf.data, all samples' bytes given as one array)
const sampleBytes = (traf) => traf.data || cat(traf.samples.map((s, i) =>
  new Uint8Array(s.size).fill(((traf.fillBase ?? traf.trackId * 50) + i) & 255)));

// One moof + mdat. trafs: [{ trackId, tfdt, samples: [{ dur, size, flags, cto }],
//   fields = 'dsfc' (per-sample duration/size/flags/cto present in trun),
//   defaults: { dur, size, flags } in tfhd, firstFlags, version (trun),
//   absoluteBase (use tfhd base_data_offset), fillBase, data }]
// opts.prefix: bytes placed before the moof (styp, sidx, ...)
export function makeFragment(trafs, { prefix = new Uint8Array(0) } = {}) {
  const datas = trafs.map(sampleBytes);
  const build = (moofStart, dataStart) => {
    let off = 0;
    return mp4box('moof',
      fullbox('mfhd', 0, 0, be(1)),
      ...trafs.map((tr, k) => {
        const fields = tr.fields ?? 'dsfc';
        const d = tr.defaults || {};
        let tf = 0x20000;
        const tfParts = [be(tr.trackId)];
        if (tr.absoluteBase) { tf = 0x01; tfParts.push(be(dataStart + off, 8)); }
        if (d.dur !== undefined) { tf |= 0x08; tfParts.push(be(d.dur)); }
        if (d.size !== undefined) { tf |= 0x10; tfParts.push(be(d.size)); }
        if (d.flags !== undefined) { tf |= 0x20; tfParts.push(be(d.flags)); }
        let rf = tr.absoluteBase ? 0 : 0x01;
        if (tr.firstFlags !== undefined) rf |= 0x04;
        if (fields.includes('d')) rf |= 0x100;
        if (fields.includes('s')) rf |= 0x200;
        if (fields.includes('f')) rf |= 0x400;
        if (fields.includes('c')) rf |= 0x800;
        const per = tr.samples.map(s => cat([
          ...(fields.includes('d') ? [be(s.dur)] : []),
          ...(fields.includes('s') ? [be(s.size)] : []),
          ...(fields.includes('f') ? [be(s.flags || 0)] : []),
          ...(fields.includes('c') ? [i32(s.cto || 0)] : []),
        ]));
        const trun = fullbox('trun', tr.version || 0, rf, be(tr.samples.length),
          ...(rf & 0x01 ? [i32(dataStart - moofStart + off)] : []),
          ...(rf & 0x04 ? [be(tr.firstFlags)] : []), ...per);
        off += datas[k].length;
        return mp4box('traf', fullbox('tfhd', 0, tf, ...tfParts),
          ...(tr.tfdt === null ? [] : [fullbox('tfdt', 1, 0, be(tr.tfdt, 8))]), trun);
      }));
  };
  const moofStart = prefix.length;
  const size = build(0, 0).length;
  const moof = build(moofStart, moofStart + size + 8);
  return cat([prefix, moof, mp4box('mdat', ...datas)]);
}

// ---------- Reading a regular MP4 ----------

function boxesOf(b, start, end) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const list = [];
  while (start < end) {
    let size = v.getUint32(start), h = 8;
    if (size === 1) { size = Number(v.getBigUint64(start + 8)); h = 16; }
    list.push({ type: String.fromCharCode(...b.subarray(start + 4, start + 8)), start, body: start + h, end: start + size });
    start += size;
  }
  return list;
}

// { top: [types], mvhd, tracks: [{ handler, tkhd, mdhd, elst, stts, ctts, stss, stsc, stsz,
//   offsetBox, offsets, stsd, samples: [{ dts, cto, sync, bytes }] }] }
// startOffset: what the writer was told it had already written.
export function readMp4(b, startOffset = 0) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u = o => v.getUint32(o), s = o => v.getInt32(o);
  const top = boxesOf(b, 0, b.length);
  const kids = x => boxesOf(b, x.body, x.end);
  const kid = (x, t) => kids(x).find(k => k.type === t);
  const moov = top.find(x => x.type === 'moov');
  const mvhd = kid(moov, 'mvhd');
  const table = (x, width, fn) => {
    if (!x) return null;
    const n = u(x.body + 4);
    return Array.from({ length: n }, (_, i) => fn(x.body + 8 + i * width));
  };
  const tracks = kids(moov).filter(x => x.type === 'trak').map(trak => {
    const tkhd = kid(trak, 'tkhd'), mdia = kid(trak, 'mdia'), mdhd = kid(mdia, 'mdhd');
    const stbl = kid(kid(mdia, 'minf'), 'stbl');
    const elst = kid(kid(trak, 'edts'), 'elst');
    const ctts = kid(stbl, 'ctts');
    const co = kid(stbl, 'stco') || kid(stbl, 'co64');
    const stsz = kid(stbl, 'stsz');
    const t = {
      handler: String.fromCharCode(...b.subarray(kid(mdia, 'hdlr').body + 8, kid(mdia, 'hdlr').body + 12)),
      tkhd: { id: u(tkhd.body + 12), duration: u(tkhd.body + 20), flags: u(tkhd.body) & 0xffffff,
              alternate: v.getUint16(tkhd.body + 34), volume: v.getUint16(tkhd.body + 36),
              width: u(tkhd.end - 8) / 65536, height: u(tkhd.end - 4) / 65536 },
      language: unpackLanguage(v.getUint16(b[mdhd.body] ? mdhd.body + 32 : mdhd.body + 20)),
      mediaHeader: kids(kid(mdia, 'minf'))[0].type,
      mdhd: b[mdhd.body] ? { timescale: u(mdhd.body + 20), duration: Number(v.getBigUint64(mdhd.body + 24)) }
                         : { timescale: u(mdhd.body + 12), duration: u(mdhd.body + 16) },
      elst: table(elst, 12, o => [u(o), s(o + 4)]),
      stts: table(kid(stbl, 'stts'), 8, o => [u(o), u(o + 4)]),
      ctts: ctts ? { version: b[ctts.body], entries: table(ctts, 8, o => [u(o), b[ctts.body] ? s(o + 4) : u(o + 4)]) } : null,
      stss: table(kid(stbl, 'stss'), 4, o => u(o)),
      stsc: table(kid(stbl, 'stsc'), 12, o => [u(o), u(o + 4), u(o + 8)]),
      stsz: Array.from({ length: u(stsz.body + 8) }, (_, i) => u(stsz.body + 12 + 4 * i)),
      offsetBox: co.type,
      offsets: table(co, co.type === 'co64' ? 8 : 4, o => co.type === 'co64' ? Number(v.getBigUint64(o)) : u(o)),
      stsd: b.slice(kid(stbl, 'stsd').start, kid(stbl, 'stsd').end),
      stsdCount: u(kid(stbl, 'stsd').body + 4),
    };
    // Resolve every sample
    const durs = t.stts.flatMap(([n, d]) => Array(n).fill(d));
    const ctos = t.ctts ? t.ctts.entries.flatMap(([n, c]) => Array(n).fill(c)) : durs.map(() => 0);
    const perChunk = t.offsets.map((_, c) => {
      let n = 0;
      for (const [first, count] of t.stsc) if (first <= c + 1) n = count;
      return n;
    });
    t.samples = [];
    let i = 0, dts = 0;
    t.offsets.forEach((off, c) => {
      let p = off - startOffset;
      for (let k = 0; k < perChunk[c]; k++, i++) {
        t.samples.push({ dts, cto: ctos[i], sync: t.stss ? t.stss.includes(i + 1) : true,
                         bytes: b.slice(p, p + t.stsz[i]) });
        p += t.stsz[i]; dts += durs[i];
      }
    });
    return t;
  });
  return {
    top: top.map(x => x.type),
    mvhd: { timescale: u(mvhd.body + 12), duration: u(mvhd.body + 16), next: u(mvhd.end - 4) },
    tracks,
    tags: readTags(b, kid(moov, 'udta')),
  };
}

const unpackLanguage = n => String.fromCharCode(((n >> 10) & 31) + 0x60, ((n >> 5) & 31) + 0x60, (n & 31) + 0x60);

// moov/udta/meta/ilst -> { atom: value }: text as strings, integers as numbers,
// images as { type, bytes }. null when there is no udta.
function readTags(b, udta) {
  if (!udta) return null;
  const meta = boxesOf(b, udta.body, udta.end).find(x => x.type === 'meta');
  const inMeta = boxesOf(b, meta.body + 4, meta.end);  // meta is a full box
  const hdlr = inMeta.find(x => x.type === 'hdlr');
  const ilst = inMeta.find(x => x.type === 'ilst');
  const tags = { handler: String.fromCharCode(...b.subarray(hdlr.body + 8, hdlr.body + 12)) };
  for (const item of boxesOf(b, ilst.body, ilst.end)) {
    const data = boxesOf(b, item.body, item.end)[0];
    const type = (b[data.body + 1] << 16) | (b[data.body + 2] << 8) | b[data.body + 3];
    const value = b.subarray(data.body + 8, data.end);
    const atom = item.type.replace('©', '(c)');
    tags[atom] = type === 1 ? new TextDecoder().decode(value)
      : type === 21 ? value.reduce((n, x) => n * 256 + x, 0)
      : { type, bytes: value.slice() };
  }
  return tags;
}

// Collects writes into one Uint8Array
export function collector() {
  const chunks = [];
  return { write: async c => { chunks.push(c.slice()); }, bytes: () => cat(chunks), chunks };
}
