// ruv-dl web: writes a regular (non-fragmented) MP4 from fragmented MP4 input.
// No DOM access here.
//
// mux.js (and fMP4 HLS streams) produce fragments: moof (sample timing) +
// mdat (sample bytes). Only the samples are used. Their bytes are written as
// they arrive, their timing is kept in memory, and one moov is written at the
// end:
//
//   ftyp                    written first
//   mdat                    one per incoming fragment, copied as it arrives
//   ...
//   moov                    written by finish()
//
// Nothing is ever seeked back to or patched, so a plain write(chunk) is enough.

export class UnsupportedError extends Error {}

const UNCONVERTIBLE = 'Could not convert this stream to MP4.';
const fail = (msg = UNCONVERTIBLE) => { throw new UnsupportedError(msg); };

const MOVIE_TIMESCALE = 1000;
const MAX_GAP_SECONDS = 1;

// ---------- Reading boxes ----------

const u8str = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const i32 = (b, o) => u32(b, o) | 0;
const u64 = (b, o) => u32(b, o) * 2 ** 32 + u32(b, o + 4);

// Boxes between start and end: [{ type, start, body, end }]
export function boxes(b, start = 0, end = b.length) {
  const list = [];
  while (start + 8 <= end) {
    let size = u32(b, start);
    let header = 8;
    if (size === 1) {
      if (start + 16 > end) fail();
      size = u64(b, start + 8); header = 16;
    } else if (size === 0) size = end - start;
    if (size < header || start + size > end) fail();
    list.push({ type: u8str(b, start + 4), start, body: start + header, end: start + size });
    start += size;
  }
  return list;
}
export const children = (b, parent) => boxes(b, parent.body, parent.end);
export const child = (b, parent, type) => children(b, parent).find(x => x.type === type);
const need = (box) => box || fail();

// In tkhd and mdhd the field after the times moves with the box version
const afterTimes = (b, full) => full.body + 4 + (b[full.body] === 1 ? 16 : 8);

// The tracks of an init segment (moov):
// [{ id, handler, timescale, entries, entryCount, wh, trex }]
// entries are the stsd's sample entries (avc1, mp4a, ...) as raw bytes.
export function parseInit(b) {
  const moov = need(boxes(b).find(x => x.type === 'moov'));
  const kids = children(b, moov);
  const trexes = {};
  const mvex = kids.find(x => x.type === 'mvex');
  for (const t of mvex ? children(b, mvex).filter(x => x.type === 'trex') : []) {
    trexes[u32(b, t.body + 4)] = { dur: u32(b, t.body + 12), size: u32(b, t.body + 16), flags: u32(b, t.body + 20) };
  }
  return kids.filter(x => x.type === 'trak').map(trak => {
    const tkhd = need(child(b, trak, 'tkhd'));
    const mdia = need(child(b, trak, 'mdia'));
    const mdhd = need(child(b, mdia, 'mdhd'));
    const hdlr = need(child(b, mdia, 'hdlr'));
    const stbl = need(child(b, need(child(b, mdia, 'minf')), 'stbl'));
    const stsd = need(child(b, stbl, 'stsd'));
    const id = u32(b, afterTimes(b, tkhd));
    return {
      id,
      handler: u8str(b, hdlr.body + 8),
      timescale: u32(b, afterTimes(b, mdhd)),
      entries: b.slice(stsd.body + 8, stsd.end),
      entryCount: u32(b, stsd.body + 4),
      wh: b.slice(tkhd.end - 8, tkhd.end),  // width, height (16.16 fixed point)
      trex: trexes[id] || { dur: 0, size: 0, flags: 0 },
    };
  });
}

// The fragments in b: [{ moof, mdat, trafs: [{ trackId, tfdt, runs: [{ start, samples }] }] }]
// Each run's start is where its sample bytes begin in b; samples are
// { dur, size, flags, cto }. styp, sidx, prft, emsg and the like are skipped.
export function parseFragments(b, tracksById = {}) {
  const out = [];
  let moof = null;
  for (const x of boxes(b)) {
    if (x.type === 'moof') { moof = x; continue; }
    if (x.type !== 'mdat' || !moof) continue;
    const trafs = [];
    let traEnd = moof.start;  // end of the previous traf's data (default base)
    for (const traf of children(b, moof).filter(k => k.type === 'traf')) {
      const tfhd = need(child(b, traf, 'tfhd'));
      const tf = u32(b, tfhd.body) & 0xffffff;
      const trackId = u32(b, tfhd.body + 4);
      const trex = tracksById[trackId]?.trex || { dur: 0, size: 0, flags: 0 };
      let o = tfhd.body + 8;
      let base;
      if (tf & 0x01) { base = u64(b, o); o += 8; } else base = trafs.length && !(tf & 0x20000) ? traEnd : moof.start;
      if (tf & 0x02) o += 4;
      const defDur = tf & 0x08 ? u32(b, (o += 4) - 4) : trex.dur;
      const defSize = tf & 0x10 ? u32(b, (o += 4) - 4) : trex.size;
      const defFlags = tf & 0x20 ? u32(b, (o += 4) - 4) : trex.flags;
      const tfdtBox = child(b, traf, 'tfdt');
      const tfdt = tfdtBox ? (b[tfdtBox.body] === 1 ? u64(b, tfdtBox.body + 4) : u32(b, tfdtBox.body + 4)) : null;
      const runs = [];
      let next = base;
      for (const trun of children(b, traf).filter(k => k.type === 'trun')) {
        const v = b[trun.body];
        const rf = u32(b, trun.body) & 0xffffff;
        const n = u32(b, trun.body + 4);
        let p = trun.body + 8;
        let start = next;
        if (rf & 0x01) { start = base + i32(b, p); p += 4; }
        let firstFlags = null;
        if (rf & 0x04) { firstFlags = u32(b, p); p += 4; }
        const per = 4 * ((rf & 0x100 ? 1 : 0) + (rf & 0x200 ? 1 : 0) + (rf & 0x400 ? 1 : 0) + (rf & 0x800 ? 1 : 0));
        if (p + per * n > trun.end) fail();
        const samples = new Array(n);
        let bytes = 0;
        for (let i = 0; i < n; i++) {
          const dur = rf & 0x100 ? u32(b, (p += 4) - 4) : defDur;
          const size = rf & 0x200 ? u32(b, (p += 4) - 4) : defSize;
          const flags = rf & 0x400 ? u32(b, (p += 4) - 4) : i === 0 && firstFlags !== null ? firstFlags : defFlags;
          const cto = rf & 0x800 ? (v ? i32(b, (p += 4) - 4) : u32(b, (p += 4) - 4)) : 0;
          samples[i] = { dur, size, flags, cto };
          bytes += size;
        }
        runs.push({ start, bytes, samples });
        next = start + bytes;
      }
      traEnd = next;
      trafs.push({ trackId, tfdt, runs });
    }
    out.push({ moof, mdat: x, trafs });
    moof = null;
  }
  return out;
}

// ---------- Growing tables ----------

class Column {
  constructor(Type) { this.Type = Type; this.a = new Type(1024); this.length = 0; }
  push(v) {
    if (this.length === this.a.length) {
      const bigger = new this.Type(this.a.length * 2);
      bigger.set(this.a);
      this.a = bigger;
    }
    this.a[this.length++] = v;
  }
  get(i) { return this.a[i]; }
  last() { return this.a[this.length - 1]; }
}

// ---------- Writing boxes ----------

// Box writer over a preallocated buffer
class Out {
  constructor(size) { this.b = new Uint8Array(size); this.v = new DataView(this.b.buffer); this.o = 0; }
  u8(x) { this.b[this.o++] = x; }
  u16(x) { this.v.setUint16(this.o, x); this.o += 2; }
  u32(x) { this.v.setUint32(this.o, x >>> 0); this.o += 4; }
  i32(x) { this.v.setInt32(this.o, x); this.o += 4; }
  u64(x) { this.u32(Math.floor(x / 2 ** 32)); this.u32(x % 2 ** 32); }
  str(s) { for (let i = 0; i < s.length; i++) this.b[this.o++] = s.charCodeAt(i); }
  zeros(n) { this.o += n; }
  bytes(a) { this.b.set(a, this.o); this.o += a.length; }
  done() { if (this.o !== this.b.length) throw new Error(`box size ${this.o} != ${this.b.length}`); return this.b; }
}

// Plain box around already-built children
function box(type, parts) {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const w = new Out(size);
  w.u32(size); w.str(type);
  for (const p of parts) w.bytes(p);
  return w.done();
}

// Full box: fill(w) writes bodySize bytes after version and flags
function full(type, version, flags, bodySize, fill) {
  const w = new Out(12 + bodySize);
  w.u32(12 + bodySize); w.str(type); w.u8(version); w.u8(flags >>> 16); w.u16(flags & 0xffff);
  fill(w);
  return w.done();
}

const matrix = w => { w.u32(0x10000); w.zeros(12); w.u32(0x10000); w.zeros(12); w.u32(0x40000000); };

// Run-length pairs [count, value] over a column (as two typed arrays)
function runs(col) {
  const counts = new Column(Uint32Array);
  const values = new Column(col.Type);
  for (let i = 0; i < col.length; i++) {
    const x = col.get(i);
    if (values.length && values.last() === x) counts.a[counts.length - 1]++;
    else { counts.push(1); values.push(x); }
  }
  return { counts, values, n: counts.length };
}

function sampleTables(t) {
  const descBytes = t.descs.reduce((k, d) => k + d.entries.length, 0);
  const out = [full('stsd', 0, 0, 4 + descBytes, w => {
    w.u32(t.descs.reduce((k, d) => k + d.entryCount, 0));
    for (const d of t.descs) w.bytes(d.entries);
  })];
  const n = t.size.length;

  const stts = runs(t.dur);
  out.push(full('stts', 0, 0, 4 + 8 * stts.n, w => {
    w.u32(stts.n);
    for (let i = 0; i < stts.n; i++) { w.u32(stts.counts.get(i)); w.u32(stts.values.get(i)); }
  }));

  let anyCto = false, negative = false;
  for (let i = 0; i < n; i++) { const c = t.cto.get(i); if (c) anyCto = true; if (c < 0) negative = true; }
  if (anyCto) {
    const ctts = runs(t.cto);
    out.push(full('ctts', negative ? 1 : 0, 0, 4 + 8 * ctts.n, w => {
      w.u32(ctts.n);
      for (let i = 0; i < ctts.n; i++) { w.u32(ctts.counts.get(i)); w.i32(ctts.values.get(i)); }
    }));
  }

  if (t.handler === 'vide') {
    let syncs = 0;
    for (let i = 0; i < n; i++) syncs += t.sync.get(i);
    if (syncs < n) {
      out.push(full('stss', 0, 0, 4 + 4 * syncs, w => {
        w.u32(syncs);
        for (let i = 0; i < n; i++) if (t.sync.get(i)) w.u32(i + 1);
      }));
    }
  }

  // stsc: a new entry whenever samples per chunk or the sample description changes
  const chunks = t.chunkCount.length;
  const same = i => i && t.chunkCount.get(i) === t.chunkCount.get(i - 1) && t.chunkDesc.get(i) === t.chunkDesc.get(i - 1);
  let stscN = 0;
  for (let i = 0; i < chunks; i++) if (!same(i)) stscN++;
  out.push(full('stsc', 0, 0, 4 + 12 * stscN, w => {
    w.u32(stscN);
    for (let i = 0; i < chunks; i++) {
      if (same(i)) continue;
      w.u32(i + 1); w.u32(t.chunkCount.get(i)); w.u32(t.chunkDesc.get(i));
    }
  }));

  out.push(full('stsz', 0, 0, 8 + 4 * n, w => {
    w.u32(0); w.u32(n);
    for (let i = 0; i < n; i++) w.u32(t.size.get(i));
  }));

  const big = chunks && t.chunkOffset.last() >= 2 ** 32;  // offsets only grow
  out.push(full(big ? 'co64' : 'stco', 0, 0, 4 + (big ? 8 : 4) * chunks, w => {
    w.u32(chunks);
    for (let i = 0; i < chunks; i++) big ? w.u64(t.chunkOffset.get(i)) : w.u32(t.chunkOffset.get(i));
  }));
  return box('stbl', out);
}

// ---------- The writer ----------

// write(chunk) is called in order and may return a promise.
// startOffset pretends the output already holds that many bytes (tests only:
// it lets co64 be tested without writing 4 GB).
export function createMp4Writer({ write, startOffset = 0 }) {
  const tracks = [];    // every track, in the order they were added
  let pos = startOffset;
  let started = false;
  let finished = false;

  const put = async chunk => { await write(chunk); pos += chunk.length; };
  const start = async () => {
    if (started) return;
    started = true;
    const w = new Out(32);
    w.u32(32); w.str('ftyp'); w.str('isom'); w.u32(512); w.str('isomiso2avc1mp41');
    await put(w.done());
  };

  // Adds the tracks of an init segment (only the one with this handler,
  // 'vide' or 'soun', when given). Returns a source handle for addFragment:
  // its fragments' track IDs are matched against this init segment only, so
  // two sources may reuse the same IDs.
  function addTrack(init, handler = null) {
    if (finished) throw new Error('writer is finished');
    let found = parseInit(init);
    if (handler) found = found.filter(t => t.handler === handler);
    else found = found.filter(t => t.handler === 'vide' || t.handler === 'soun');
    if (!found.length) {
      fail(handler ? `The stream has no ${handler === 'soun' ? 'audio' : 'video'} track.` : UNCONVERTIBLE);
    }
    const byId = {};
    for (const info of found) {
      const t = {
        ...info,
        dur: new Column(Uint32Array), size: new Column(Uint32Array), cto: new Column(Int32Array),
        sync: new Column(Uint8Array), chunkOffset: new Column(Float64Array), chunkCount: new Column(Uint32Array),
        chunkDesc: new Column(Uint32Array),
        // Sample descriptions; desc is the 1-based stsd index the next chunks use
        descs: [{ entries: info.entries, entryCount: info.entryCount, index: 1 }], desc: 1,
        firstDts: null, firstCto: 0, nextDts: null,
        gaps: 0, gapTicks: 0, trims: 0, trimTicks: 0,
      };
      tracks.push(t);
      byId[t.id] = t;
    }
    return { byId };
  }

  // mux.js sends an init segment with every segment. When the codec setup
  // changes (new H.264 SPS/PPS: RÚV streams often open with a differently
  // encoded intro), the following chunks get a second sample description.
  // A different track, timescale or picture size is refused.
  function updateInit(src, init) {
    const now = parseInit(init);
    for (const t of Object.values(src.byId)) {
      const same = now.find(x => x.id === t.id && x.handler === t.handler);
      if (!same || same.timescale !== t.timescale || !sameBytes(same.wh, t.wh)) {
        fail('The stream changes format partway through (for example its resolution), which is not supported.');
      }
      let d = t.descs.find(x => sameBytes(x.entries, same.entries));
      if (!d) {
        if (same.entryCount !== 1 || t.descs.some(x => x.entryCount !== 1)) fail();
        d = { entries: same.entries, entryCount: 1, index: t.descs.length + 1 };
        t.descs.push(d);
      }
      t.desc = d.index;
    }
  }

  // Adds the fragments in bytes (moof + mdat pairs, any number). When init
  // is given (mux.js sends one with every segment) it applies to these fragments.
  async function addFragment(src, bytes, init = null) {
    if (finished) throw new Error('writer is finished');
    if (init) updateInit(src, init);
    await start();
    for (const { mdat, trafs } of parseFragments(bytes, src.byId)) {
      const ours = trafs.filter(tr => src.byId[tr.trackId]);
      if (!ours.length) continue;
      const payloadIn = mdat.body;
      const payloadLen = mdat.end - mdat.body;
      const large = payloadLen + 8 >= 2 ** 32;
      const payloadOut = pos + (large ? 16 : 8);

      // Work out every sample first, so a bad fragment raises before anything is written
      const plans = ours.map(tr => planTraf(src.byId[tr.trackId], tr, payloadIn, mdat.end));

      const header = new Out(large ? 16 : 8);
      if (large) { header.u32(1); header.str('mdat'); header.u64(payloadLen + 16); } else { header.u32(payloadLen + 8); header.str('mdat'); }
      await put(header.done());
      await put(bytes.subarray(payloadIn, mdat.end));

      for (const plan of plans) commit(plan, payloadOut - payloadIn);
    }
  }

  // Which samples of a traf to keep, and the timing fix at its start
  function planTraf(t, traf, mdatStart, mdatEnd) {
    let dts = traf.tfdt;
    if (dts === null) dts = t.nextDts ?? 0;
    let total = 0;
    for (const run of traf.runs) {
      if (run.start < mdatStart || run.start + run.bytes > mdatEnd) fail();
      for (const s of run.samples) total += s.dur;
    }
    let skipBefore = -Infinity;
    if (t.nextDts !== null && dts < t.nextDts) {
      // Overlap: mux.js repeats the previous segment's last GOP in front of a
      // segment that does not start with a key frame. Drop the repeats.
      const overlap = t.nextDts - dts;
      if (overlap > total) fail('The stream\'s timestamps jump backwards, which is not supported.');
      skipBefore = t.nextDts;
    }
    const keep = [];  // { off (in input), n, samples }
    let time = dts;
    let firstKeptDts = null;
    for (const run of traf.runs) {
      let off = run.start;
      let chunk = null;
      for (const s of run.samples) {
        if (time < skipBefore) { off += s.size; time += s.dur; continue; }
        if (firstKeptDts === null) firstKeptDts = time;
        if (!chunk) keep.push(chunk = { off, samples: [] });
        chunk.samples.push(s);
        off += s.size; time += s.dur;
      }
    }
    let gap = 0;
    if (t.nextDts !== null && firstKeptDts !== null && firstKeptDts > t.nextDts) {
      gap = firstKeptDts - t.nextDts;
      if (gap > MAX_GAP_SECONDS * t.timescale && skipBefore === -Infinity) {
        fail('The stream has a gap of more than a second, which is not supported.');
      }
    }
    return { t, firstKeptDts, keep, gap, trimmed: skipBefore === -Infinity ? 0 : t.nextDts - dts, end: dts + total };
  }

  function commit({ t, firstKeptDts, keep, gap, trimmed, end }, shift) {
    if (gap) {
      // Gap: lengthen the previous sample to close it
      if (t.dur.length) t.dur.a[t.dur.length - 1] += gap;
      t.gaps++; t.gapTicks += gap;
    }
    if (trimmed) { t.trims++; t.trimTicks += trimmed; }
    for (const chunk of keep) {
      if (t.firstDts === null) { t.firstDts = firstKeptDts; t.firstCto = chunk.samples[0].cto; }
      t.chunkOffset.push(chunk.off + shift);
      t.chunkCount.push(chunk.samples.length);
      t.chunkDesc.push(t.desc);
      for (const s of chunk.samples) {
        t.dur.push(s.dur); t.size.push(s.size); t.cto.push(s.cto);
        t.sync.push(s.flags & 0x10000 ? 0 : 1);
      }
    }
    // After a full overlap end equals nextDts; it never moves backwards
    if (t.nextDts === null || end > t.nextDts) t.nextDts = end;
  }

  // Writes the moov. Returns { bytes, duration (seconds), tracks: stats }.
  async function finish() {
    if (finished) throw new Error('writer is finished');
    finished = true;
    const used = tracks.filter(t => t.size.length);
    if (!used.length) fail();
    await start();

    const startTime = t => (t.firstDts + t.firstCto) / t.timescale;
    const t0 = Math.min(...used.map(startTime));
    let movieDur = 0;
    const traks = used.map((t, k) => {
      let mediaDur = 0;
      for (let i = 0; i < t.dur.length; i++) mediaDur += t.dur.get(i);
      const presented = Math.max(0, mediaDur - t.firstCto);
      const delay = Math.round((startTime(t) - t0) * MOVIE_TIMESCALE);
      const shown = Math.round(presented / t.timescale * MOVIE_TIMESCALE);
      const editDur = delay + shown;
      movieDur = Math.max(movieDur, editDur);
      t.delay = delay / MOVIE_TIMESCALE;
      t.duration = mediaDur / t.timescale;

      const vide = t.handler === 'vide';
      const tkhd = full('tkhd', 0, 3, 80, w => {
        w.zeros(8); w.u32(k + 1); w.zeros(4); w.u32(editDur); w.zeros(8);
        w.u16(0); w.u16(vide ? 0 : 1); w.u16(vide ? 0 : 0x0100); w.u16(0);
        matrix(w); w.bytes(t.wh);
      });
      const entries = delay > 0 ? 2 : 1;
      const elst = full('elst', 0, 0, 4 + 12 * entries, w => {
        w.u32(entries);
        if (delay > 0) { w.u32(delay); w.i32(-1); w.u32(0x10000); }
        w.u32(shown); w.i32(t.firstCto); w.u32(0x10000);
      });
      const v1 = mediaDur >= 2 ** 32;
      const mdhd = full('mdhd', v1 ? 1 : 0, 0, v1 ? 32 : 20, w => {
        if (v1) { w.zeros(16); w.u32(t.timescale); w.u64(mediaDur); } else { w.zeros(8); w.u32(t.timescale); w.u32(mediaDur); }
        w.u16(0x55c4); w.u16(0);
      });
      const name = vide ? 'VideoHandler\0' : 'SoundHandler\0';
      const hdlr = full('hdlr', 0, 0, 20 + name.length, w => { w.zeros(4); w.str(t.handler); w.zeros(12); w.str(name); });
      const mhd = vide ? full('vmhd', 0, 1, 8, w => w.zeros(8)) : full('smhd', 0, 0, 4, w => w.zeros(4));
      const dinf = box('dinf', [full('dref', 0, 0, 4 + 12, w => { w.u32(1); w.bytes(full('url ', 0, 1, 0, () => {})); })]);
      const minf = box('minf', [mhd, dinf, sampleTables(t)]);
      return box('trak', [tkhd, box('edts', [elst]), box('mdia', [mdhd, hdlr, minf])]);
    });
    const mvhd = full('mvhd', 0, 0, 96, w => {
      w.zeros(8); w.u32(MOVIE_TIMESCALE); w.u32(movieDur); w.u32(0x10000); w.u16(0x0100); w.zeros(10);
      matrix(w); w.zeros(24); w.u32(used.length + 1);
    });
    await put(box('moov', [mvhd, ...traks]));
    return {
      bytes: pos - startOffset,
      duration: movieDur / MOVIE_TIMESCALE,
      tracks: used.map(t => ({
        handler: t.handler, samples: t.size.length, chunks: t.chunkCount.length, descriptions: t.descs.length, delay: t.delay,
        duration: t.duration, gaps: t.gaps, gapSeconds: t.gapTicks / t.timescale,
        trims: t.trims, trimSeconds: t.trimTicks / t.timescale,
      })),
    };
  }

  return { addTrack, addFragment, finish };
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

