// Run with: node --test web/test/   (Node 18+, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRuvUrl, sanitize, fileTitle, parseMaster, parseMedia, isMediaPlaylist,
  downloadHls, parseVtt, splitSeason, fileTags, getFileExtras, getEpisodeList, numbersAreUnique, cuesToSrt, getProgram, GeoblockError, UnsupportedError,
  NotFoundError, ruvUrlFromLocation, estimateBytes, countryFromTrace, flagEmoji,
} from '../ruvdl.js';
import { makeInit, makeFragment, readMp4, mp4box, cat } from './fixtures.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=SUBTITLES,URI="888/index.m3u8",GROUP-ID="vtt",LANGUAGE="ice",NAME="Subtitle0"
#EXT-X-STREAM-INF:BANDWIDTH=936688,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=640x360,SUBTITLES="vtt"
800/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3862357,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,SUBTITLES="vtt"
3600/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2636511,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=1280x720,SUBTITLES="vtt"
2400/index.m3u8?token=abc
#EXT-X-STREAM-INF:BANDWIDTH=1345286,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=852x480,SUBTITLES="vtt"
1200/index.m3u8
`;
const BASE = 'https://ruv-vod.akamaized.net/lokad/5500416A0/5500416A0.m3u8';

const media = (n, extra = '') => `#EXTM3U
#EXT-X-TARGETDURATION:6
${extra}
${Array.from({ length: n }, (_, i) => `#EXTINF:6.000,\nsegment${i}.ts`).join('\n')}
#EXT-X-ENDLIST
`;

function fakeFetch(routes, log = []) {
  return async (url, opts = {}) => {
    log.push(url);
    if (opts.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const route = routes(url);
    if (route instanceof Error) throw route;
    const { status = 200, body = '' } = typeof route === 'object' && !(route instanceof Uint8Array)
      ? route : { body: route };
    return new Response(status === 200 ? body : null, { status });
  };
}

test('parseRuvUrl handles all link forms', () => {
  const cases = {
    'https://www.ruv.is/sjonvarp/spila/show/37230/b31m75': ['37230', 'b31m75'],
    'https://www.ruv.is/sjonvarp/spila/show/37230?ep=b31m75': ['37230', 'b31m75'],
    'https://www.ruv.is/sjonvarp/spila/show/37230/': ['37230', null],
    ' https://www.ruv.is/sjonvarp/spila/2026/39292/bmmuu1 ': ['39292', 'bmmuu1'],
    'https://www.ruv.is/frettir': [null, null],
    '': [null, null],
  };
  for (const [url, [programId, episodeId]] of Object.entries(cases)) {
    assert.deepEqual(parseRuvUrl(url), { programId, episodeId }, url);
  }
});

test('sanitize and fileTitle match the Python tool', () => {
  assert.equal(sanitize('Hvað/er: þetta? "já" *'), 'Hvaðer þetta já');
  assert.equal(fileTitle({ title: 'Blæja II', multiple_episodes: true }, { title: 'Mömmuskóli' }),
               'Blæja II - Mömmuskóli');
  assert.equal(fileTitle({ title: 'Kvikmynd', multiple_episodes: false }, { title: 'x' }), 'Kvikmynd');
});

test('parseMaster sorts variants best first and resolves URLs', () => {
  const variants = parseMaster(MASTER, BASE);
  assert.deepEqual(variants.map(v => v.height), [1080, 720, 480, 360]);
  assert.equal(variants[0].url, 'https://ruv-vod.akamaized.net/lokad/5500416A0/3600/index.m3u8');
  assert.equal(variants[1].url, 'https://ruv-vod.akamaized.net/lokad/5500416A0/2400/index.m3u8?token=abc');
  assert.equal(variants[0].label, '1080p · 3.9 Mbps');
  assert.equal(isMediaPlaylist(MASTER), false);
});

test('parseMaster handles audio-only and duplicate variants', () => {
  const text = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.2"
a/low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=192000,CODECS="mp4a.40.2"
a/high.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=192000,CODECS="mp4a.40.2"
a/high.m3u8
`;
  const variants = parseMaster(text, BASE);
  assert.deepEqual(variants.map(v => v.label), ['Audio · 192 kbps', 'Audio · 64 kbps']);
});

test('parseMedia reads segments, duration, encryption and fMP4 init', () => {
  const plain = parseMedia(media(3), BASE);
  assert.equal(plain.segments.length, 3);
  assert.equal(plain.segments[0], 'https://ruv-vod.akamaized.net/lokad/5500416A0/segment0.ts');
  assert.equal(plain.duration, 18);
  assert.equal(plain.encrypted, false);
  assert.equal(isMediaPlaylist(media(1)), true);

  assert.equal(parseMedia(media(1, '#EXT-X-KEY:METHOD=AES-128,URI="k"'), BASE).encrypted, true);
  assert.equal(parseMedia(media(1, '#EXT-X-KEY:METHOD=NONE'), BASE).encrypted, false);
  assert.equal(parseMedia(media(1, '#EXT-X-MAP:URI="init.mp4"'), BASE).map,
               'https://ruv-vod.akamaized.net/lokad/5500416A0/init.mp4');
});

// Fake mux.js: each pushed segment's bytes are a label such as "segment3.ts;"
// (or "v/…", "a/…" for separate video and audio). It becomes one real
// fragment per track, timed by the segment number (6 s each), holding the
// label as its single sample. Like mux.js it sends the init segment every time.
const transmuxerOptions = [];
function fakeMux() {
  return {
    mp4: {
      Transmuxer: class {
        constructor(options) { transmuxerOptions.push(options); this.handlers = []; this.buffered = []; }
        on(_event, fn) { this.handlers.push(fn); }
        push(bytes) { this.buffered.push(bytes); }
        flush() {
          for (const b of this.buffered.splice(0)) {
            const label = new TextDecoder().decode(b);
            const i = Number(label.match(/segment(\d+)/)[1]);
            const kinds = label.startsWith('v/') ? ['vide'] : label.startsWith('a/') ? ['soun'] : ['vide', 'soun'];
            // Muxed: video 256, audio 257 (the PIDs); separate: both 256, like RÚV's packager
            const tracks = kinds.map((handler, k) => ({ id: 256 + k, handler, timescale: 90000 }));
            const data = cat(tracks.map(t => makeFragment([{
              trackId: t.id, tfdt: i * 540000, data: new TextEncoder().encode(`${t.handler}:${label}`),
              samples: [{ dur: 540000, size: t.handler.length + 1 + b.length, flags: 0 }],
            }])));
            this.handlers.forEach(fn => fn({ initSegment: makeInit(tracks), data }));
          }
        }
      },
    },
  };
}

const segmentRoutes = (n, overrides = {}) => url => {
  if (url.endsWith('index.m3u8')) return media(n);
  const name = url.split('/').pop();
  return name in overrides ? overrides[name] : new TextEncoder().encode(name + ';');
};

// Each track's samples as text, from the written file
const samplesOf = chunks => readMp4(cat(chunks)).tracks
  .map(t => t.samples.map(s => new TextDecoder().decode(s.bytes)));

test('downloadHls writes a regular MP4 with the segments in order', async () => {
  const written = [];
  const progress = [];
  transmuxerOptions.length = 0;
  // Make early segments slow so they finish after later ones
  const slowFetch = fakeFetch(segmentRoutes(6));
  const fetchFn = async (url, opts) => {
    if (/segment[01]\.ts$/.test(url)) await new Promise(r => setTimeout(r, 30));
    return slowFetch(url, opts);
  };
  const result = await downloadHls(`${BASE.replace(/[^/]+$/, '')}800/index.m3u8`, {
    muxjs: fakeMux(), fetchFn, write: async c => written.push(c),
    onProgress: p => progress.push(p.done),
  });
  const file = readMp4(cat(written));
  // ftyp, then video and audio fragments of each segment, moov at the end
  assert.deepEqual(file.top, ['ftyp', ...Array(12).fill('mdat'), 'moov']);
  const segs = [0, 1, 2, 3, 4, 5].map(i => `segment${i}.ts;`);
  assert.deepEqual(samplesOf(written), [segs.map(s => `vide:${s}`), segs.map(s => `soun:${s}`)]);
  assert.deepEqual(file.tracks.map(t => t.stts), [[[6, 540000]], [[6, 540000]]]);
  assert.equal(file.mvhd.duration, 36000);
  assert.deepEqual(progress, [1, 2, 3, 4, 5, 6]);
  assert.equal(result.duration, 36);
  assert.equal(result.bytes, cat(written).length);
  assert.deepEqual(transmuxerOptions, [{ keepOriginalTimestamps: true }]);
});

test('downloadHls retries a failing segment', async () => {
  let failures = 1;
  const base = fakeFetch(segmentRoutes(2));
  const fetchFn = async (url, opts) => {
    if (url.endsWith('segment1.ts') && failures-- > 0) return new Response(null, { status: 500 });
    return base(url, opts);
  };
  const written = [];
  await downloadHls('https://x/v/index.m3u8', {
    muxjs: fakeMux(), fetchFn, write: async c => written.push(c),
  });
  assert.deepEqual(samplesOf(written)[0], ['vide:segment0.ts;', 'vide:segment1.ts;']);
});

test('downloadHls reports geoblocking without retrying', async () => {
  const log = [];
  const fetchFn = fakeFetch(segmentRoutes(3, { 'segment0.ts': { status: 403 } }), log);
  await assert.rejects(
    downloadHls('https://x/v/index.m3u8', { muxjs: fakeMux(), fetchFn, write: async () => {} }),
    GeoblockError);
  assert.equal(log.filter(u => u.endsWith('segment0.ts')).length, 1);
});

test('downloadHls refuses encrypted streams', async () => {
  const fetchFn = fakeFetch(() => media(2, '#EXT-X-KEY:METHOD=AES-128,URI="k"'));
  await assert.rejects(
    downloadHls('https://x/v/index.m3u8', { muxjs: fakeMux(), fetchFn, write: async () => {} }),
    UnsupportedError);
});

test('downloadHls reads fMP4 streams without mux.js', async () => {
  const fetchFn = fakeFetch(url => {
    const name = url.split('/').pop();
    if (name.endsWith('.m3u8')) return media(2, '#EXT-X-MAP:URI="init.mp4"');
    if (name === 'init.mp4') return makeInit([{ id: 1, handler: 'vide', timescale: 90000 }]);
    const i = Number(name.match(/\d/)[0]);
    return makeFragment([{ trackId: 1, tfdt: i * 540000, data: new TextEncoder().encode(name),
      samples: [{ dur: 540000, size: name.length }] }], { prefix: mp4box('styp', new Uint8Array(8)) });
  });
  const written = [];
  await downloadHls('https://x/v/index.m3u8', {
    muxjs: null, fetchFn, write: async c => written.push(c),
  });
  assert.deepEqual(readMp4(cat(written)).top, ['ftyp', 'mdat', 'mdat', 'moov']);
  assert.deepEqual(samplesOf(written), [['segment0.ts', 'segment1.ts']]);
});

test('downloadHls refuses a stream mux.js cannot convert', async () => {
  const silentMux = { mp4: { Transmuxer: class { on() {} push() {} flush() {} } } };
  await assert.rejects(downloadHls('https://x/v/index.m3u8', {
    muxjs: silentMux, fetchFn: fakeFetch(segmentRoutes(2)), write: async () => {},
  }), UnsupportedError);
});

test('downloadHls stops when cancelled', async () => {
  const controller = new AbortController();
  let writes = 0;
  const fetchFn = fakeFetch(segmentRoutes(50));
  await assert.rejects(downloadHls('https://x/v/index.m3u8', {
    muxjs: fakeMux(), fetchFn, signal: controller.signal,
    write: async () => { if (++writes === 3) controller.abort(); },
  }));
  assert.ok(writes < 50);
});

// ---------- Separate audio renditions ----------

test('parseMaster links a separate audio rendition, preferring Icelandic', () => {
  const text = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ENG",DEFAULT=YES,LANGUAGE="en",URI="ENG/stream.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ISL-AD",LANGUAGE="is",CHARACTERISTICS="public.accessibility.describes-video",URI="AD/stream.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ISL",LANGUAGE="is",URI="ISL/stream.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=7092698,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",AUDIO="aud"
1080p/stream.m3u8
`;
  assert.equal(parseMaster(text, BASE)[0].audio,
               'https://ruv-vod.akamaized.net/lokad/5500416A0/ISL/stream.m3u8');
  // Plain playlists have no separate audio
  assert.equal(parseMaster(MASTER, BASE)[0].audio, null);
});

test('parseMaster uses separate audio when a variant has no RESOLUTION or CODECS', () => {
  const text = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ISL",DEFAULT=YES,LANGUAGE="is",URI="ISL/stream.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,AUDIO="aud"
video/stream.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=128000,AUDIO="aud"
ISL/stream.m3u8
`;
  const isl = 'https://ruv-vod.akamaized.net/lokad/5500416A0/ISL/stream.m3u8';
  // The bare variant gets the rendition; the rendition itself, listed as a variant, does not
  assert.deepEqual(parseMaster(text, BASE).map(v => [v.url, v.audio]), [
    ['https://ruv-vod.akamaized.net/lokad/5500416A0/video/stream.m3u8', isl],
    [isl, null],
  ]);
});

test('parseMaster treats an audio group without URI as muxed audio', () => {
  const text = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="2@48000-mp4a-0",NAME="Audio 1",DEFAULT=NO,AUTOSELECT=YES
#EXT-X-STREAM-INF:BANDWIDTH=4317204,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,AUDIO="2@48000-mp4a-0"
3600/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2",AUDIO="2@48000-mp4a-0"
a/index.m3u8
`;
  assert.deepEqual(parseMaster(text, BASE).map(v => v.audio), [null, null]);
});

test('parseMedia gives each segment its start time', () => {
  const text = '#EXTM3U\n#EXTINF:6.4,\na.ts\n#EXTINF:6.0,\nb.ts\n#EXTINF:5.5,\nc.ts\n#EXT-X-ENDLIST\n';
  const { starts, duration } = parseMedia(text, BASE);
  assert.deepEqual(starts.map(s => Math.round(s * 10) / 10), [0, 6.4, 12.4]);
  assert.equal(Math.round(duration * 10) / 10, 17.9);
});

test('downloadHls merges separate fMP4 video and audio into one MP4 in sync', async () => {
  // Video at 90 kHz starting at 1.46 s, audio at 48 kHz starting at 1.40 s,
  // both reusing track ID 256 like RÚV's packager does
  const routes = url => {
    const name = url.split('/').slice(-2).join('/');
    if (name === 'v/index.m3u8') return '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6.4,\ns0.m4s\n#EXTINF:6.4,\ns1.m4s\n#EXT-X-ENDLIST\n';
    if (name === 'a/index.m3u8') return '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6.0,\ns0.m4s\n#EXTINF:6.0,\ns1.m4s\n#EXTINF:0.8,\ns2.m4s\n#EXT-X-ENDLIST\n';
    // The video init also lists an audio track, which must be left out
    if (name === 'v/init.mp4') return makeInit([{ id: 256, handler: 'vide', timescale: 90000 }, { id: 257, handler: 'soun' }]);
    if (name === 'a/init.mp4') return makeInit([{ id: 256, handler: 'soun', timescale: 48000 }]);
    const i = Number(name.match(/s(\d)/)[1]);
    const data = new TextEncoder().encode(name);
    if (name.startsWith('v/')) {
      return makeFragment([{ trackId: 256, tfdt: 131400 + i * 576000, data, samples: [{ dur: 576000, size: data.length }] }]);
    }
    const dur = i < 2 ? 288000 : 38400;
    return makeFragment([{ trackId: 256, tfdt: 67200 + i * 288000, data, samples: [{ dur, size: data.length }] }]);
  };
  const chunks = [];
  const progress = [];
  const result = await downloadHls('https://x/v/index.m3u8', {
    audioUrl: 'https://x/a/index.m3u8', muxjs: null, fetchFn: fakeFetch(routes),
    write: async c => chunks.push(c), onProgress: p => progress.push(`${p.done}/${p.total}`),
  });
  const file = readMp4(cat(chunks));
  assert.deepEqual(file.top, ['ftyp', 'mdat', 'mdat', 'mdat', 'mdat', 'mdat', 'moov']);
  assert.deepEqual(file.tracks.map(t => [t.handler, t.tkhd.id]), [['vide', 1], ['soun', 2]]);
  assert.equal(file.mvhd.next, 3);
  assert.deepEqual(samplesOf(chunks), [['v/s0.m4s', 'v/s1.m4s'], ['a/s0.m4s', 'a/s1.m4s', 'a/s2.m4s']]);
  // Fragments in playback order: v0 a0 a1 v1 a2
  const [v, a] = file.tracks;
  const order = [...v.offsets.map(o => [o, 'v']), ...a.offsets.map(o => [o, 'a'])].sort((x, y) => x[0] - y[0]);
  assert.equal(order.map(x => x[1]).join(''), 'vaava');
  // Audio starts at 0, video keeps its 60 ms lead-in; real lengths, not "unknown"
  assert.deepEqual(v.elst, [[60, -1], [12800, 0]]);
  assert.deepEqual(a.elst, [[12800, 0]]);
  assert.deepEqual(file.tracks.map(t => t.mdhd.duration), [12.8 * 90000, 12.8 * 48000]);
  assert.equal(file.mvhd.duration, 12860);
  assert.deepEqual(progress, ['1/5', '2/5', '3/5', '4/5', '5/5']);
  assert.equal(Math.round(result.duration * 10) / 10, 12.8);
});

test('downloadHls merges separate MPEG-TS video and audio with one transmuxer each', async () => {
  transmuxerOptions.length = 0;
  const fetchFn = fakeFetch(url => {
    const [dir, name] = url.split('/').slice(-2);
    return name.endsWith('.m3u8') ? media(2) : new TextEncoder().encode(`${dir}/${name};`);
  });
  const chunks = [];
  await downloadHls('https://x/v/index.m3u8', {
    audioUrl: 'https://x/a/index.m3u8', muxjs: fakeMux(), fetchFn, write: async c => chunks.push(c),
  });
  assert.deepEqual(samplesOf(chunks), [
    ['vide:v/segment0.ts;', 'vide:v/segment1.ts;'], ['soun:a/segment0.ts;', 'soun:a/segment1.ts;']]);
  assert.deepEqual(transmuxerOptions, [{ keepOriginalTimestamps: true }, { keepOriginalTimestamps: true }]);
});

test('downloadHls reports a separate audio playlist that is geoblocked', async () => {
  const fetchFn = fakeFetch(url => url.includes('/a/') ? { status: 403 } : media(1));
  await assert.rejects(downloadHls('https://x/v/index.m3u8', {
    audioUrl: 'https://x/a/index.m3u8', muxjs: fakeMux(), fetchFn, write: async () => {},
  }), GeoblockError);
});

test('getEpisodeList sorts oldest first, with air date, length and expiry', async () => {
  const fetchFn = async (url, opts) => {
    const { variables, query } = JSON.parse(opts.body);
    assert.equal(variables.id, 37230);
    assert.match(query, /episodes \{ id number title firstrun duration file_expires \}/);
    return new Response(JSON.stringify({ data: { Program: { title: 'x', episodes: [
      { id: 'c', number: 3, title: '3' },
      { id: 'a', number: 1, title: '1', firstrun: '2026-10-18T21:00:00', duration: 2923, file_expires: '2027-05-17' },
      { id: 'x', number: null, title: 'Aukaþáttur' }, { id: 'b', number: 2, title: '2' },
    ] } } }));
  };
  const list = await getEpisodeList('37230', { fetchFn });
  assert.deepEqual(list.map(e => e.id), ['a', 'b', 'c', 'x']);
  assert.deepEqual(list[0], { id: 'a', number: 1, title: '1', firstrun: '2026-10-18T21:00:00', duration: 2923, file_expires: '2027-05-17' });
});

test('getEpisodeList sorts by air date when the numbers repeat', async () => {
  // Blæja III: episodes come in batches whose numbering starts over
  const episodes = [
    { id: 'are58b', number: 11, firstrun: '2025-10-18T08:00:00' },
    { id: 'are581', number: 1, firstrun: '2025-08-02T08:00:00' },
    { id: 'ardhnb', number: 11, firstrun: '2025-05-25T08:00:00' },
    { id: 'ard7ur', number: 11, firstrun: '2024-11-03T08:00:00' },
    { id: 'ard7ui', number: 2, firstrun: '2024-09-01T08:00:00' },
  ];
  const fetchFn = async () => new Response(JSON.stringify({ data: { Program: { title: 'Blæja III', episodes } } }));
  const list = await getEpisodeList('36429', { fetchFn });
  assert.deepEqual(list.map(e => e.id), ['ard7ui', 'ard7ur', 'ardhnb', 'are581', 'are58b']);
});

test('numbersAreUnique ignores episodes without a number', () => {
  assert.equal(numbersAreUnique([{ number: 1 }, { number: 2 }, { number: null }, { number: '' }]), true);
  assert.equal(numbersAreUnique([{ number: 11 }, { number: '11' }]), false);
  assert.equal(numbersAreUnique([]), true);
});

test('parseVtt reads cues in seconds and drops tags, settings and entities', () => {
  const vtt = `WEBVTT

NOTE a comment

STYLE
::cue { color: yellow }

1
00:00:02.000 --> 00:00:03.080 line:90% align:center
<c.yellow>Hæ.</c> <i>Ég held</i> ég sé næstur &amp; svo.

01:05.5 --> 01:07.25
Tvær
línur

3
00:01:10.000 --> 00:01:11.000
<i></i>
`;
  assert.deepEqual(parseVtt(vtt), [
    { start: 2, end: 3.08, text: 'Hæ. Ég held ég sé næstur & svo.' },
    { start: 65.5, end: 67.25, text: 'Tvær\nlínur' },
  ]);
});

test('cuesToSrt numbers the cues and writes SRT timings', () => {
  assert.equal(cuesToSrt([
    { start: 2, end: 3.08, text: 'Hæ.' },
    { start: 3725.5, end: 3727.0004, text: 'Tvær\nlínur' },
  ]), `1
00:00:02,000 --> 00:00:03,080
Hæ.

2
01:02:05,500 --> 01:02:07,000
Tvær
línur
`);
  assert.equal(cuesToSrt([]), '');
});

test('splitSeason reads a Roman numeral at the end of the title', () => {
  assert.deepEqual(splitSeason('Blæja II'), ['Blæja', 2]);
  assert.deepEqual(splitSeason('Blæja - XIV'), ['Blæja', 14]);
  assert.deepEqual(splitSeason('Blæja'), ['Blæja', 1]);
  assert.deepEqual(splitSeason('Hinrik VIII'), ['Hinrik', 8]);
  assert.deepEqual(splitSeason('IIII'), ['IIII', 1]);  // not a canonical numeral
  assert.deepEqual(splitSeason(null), ['', 1]);
});

const PROGRAM = {
  title: 'Blæja II', multiple_episodes: true, description: ['Um Blæju.'],
  categories: [{ title: 'Barnaefni', slug: 'barnaefni' }], image_og: 'https://myndir.ruv.is/program.jpg',
};
const EPISODE = {
  id: 'abc', number: 5, title: 'Mömmuskóli', firstrun: '2024-10-14T08:00:00',
  description: ['Fyrsta lína.', 'Önnur lína.'], image_og: 'https://myndir.ruv.is/episode.jpg',
  subtitles_url: 'https://muninn.nyr.ruv.is/files/subtitles/webvtt/closed/1.vtt',
};

test('fileTags for an episode and a film, like the Python tool', () => {
  assert.deepEqual(fileTags(PROGRAM, EPISODE), {
    kind: 'tv', title: 'Mömmuskóli', show: 'Blæja', season: 2, episode: 5, episodeId: 'S02E05',
    description: 'Fyrsta lína.\nÖnnur lína.', date: '2024-10-14', genre: 'Barnaefni', network: 'RÚV',
  });
  // No episode number or description: no S01E01, the program's description instead
  const noNumber = fileTags(PROGRAM, { ...EPISODE, number: null, description: [] });
  assert.deepEqual([noNumber.episode, noNumber.episodeId, noNumber.description], [null, null, 'Um Blæju.']);
  assert.deepEqual(fileTags({ title: 'Kvikmynd', multiple_episodes: false }, { firstrun: null }), {
    kind: 'movie', title: 'Kvikmynd', description: null, date: null, genre: null, network: 'RÚV',
  });
});

const image = (type, bytes = [1, 2, 3]) => new Response(Uint8Array.from(bytes), { headers: { 'content-type': type } });

test('getFileExtras fetches subtitles and the JPEG cover', async () => {
  const log = [];
  const fetchFn = async url => {
    log.push(url);
    if (url.endsWith('.vtt')) return new Response('WEBVTT\n\n00:01.000 --> 00:02.000\nHæ\n');
    if (url.endsWith('episode.jpg')) return image('image/jpeg');
    throw new Error(`unexpected ${url}`);
  };
  const extras = await getFileExtras(PROGRAM, EPISODE, { fetchFn });
  assert.deepEqual(extras.subtitles, [{ start: 1, end: 2, text: 'Hæ' }]);
  assert.deepEqual(extras.cover, { kind: 'jpeg', data: Uint8Array.of(1, 2, 3) });
  assert.equal(extras.tags.episodeId, 'S02E05');
  assert.deepEqual(log.sort(), [EPISODE.image_og, EPISODE.subtitles_url].sort());
});

test('getFileExtras goes without subtitles or cover when they fail', async () => {
  // Program cover when the episode has none; WebP is no use as cover art
  const webp = await getFileExtras(PROGRAM, { ...EPISODE, image_og: null, subtitles_url: null }, {
    fetchFn: async url => (url === PROGRAM.image_og ? image('image/webp') : assert.fail(url)),
  });
  assert.deepEqual([webp.subtitles, webp.cover], [[], null]);

  const failing = await getFileExtras(PROGRAM, EPISODE, {
    fetchFn: async url => (url.endsWith('.vtt') ? new Response(null, { status: 404 }) : Promise.reject(new TypeError('offline'))),
  });
  assert.deepEqual([failing.subtitles, failing.cover], [[], null]);
  assert.equal(failing.tags.show, 'Blæja');
});

test('downloadHls puts subtitles, tags and cover into the file', async () => {
  const written = [];
  await downloadHls('https://x/v/index.m3u8', {
    muxjs: fakeMux(), fetchFn: fakeFetch(segmentRoutes(2)), write: async c => written.push(c),
    subtitles: [{ start: 1, end: 2, text: 'Hæ' }],
    tags: { title: 'Mömmuskóli', kind: 'tv' },
    cover: { kind: 'png', data: Uint8Array.of(9) },
  });
  const file = readMp4(cat(written));
  assert.deepEqual(file.tracks.map(t => t.handler), ['vide', 'soun', 'sbtl']);
  assert.deepEqual(file.tracks[2].samples.map(s => new TextDecoder().decode(s.bytes.subarray(2))), ['', 'Hæ']);
  assert.equal(file.tags['(c)nam'], 'Mömmuskóli');
  assert.deepEqual(file.tags.covr, { type: 14, bytes: Uint8Array.of(9) });
});

test('ruvUrlFromLocation supports ?url=, swapped domain and prefixed links', () => {
  const R = 'https://www.ruv.is';
  const cases = {
    'https://ruv-dl.is/?url=https%3A%2F%2Fwww.ruv.is%2Fsjonvarp%2Fspila%2Fx%2F1%2Fa': `${R}/sjonvarp/spila/x/1/a`,
    'https://ruv-dl.is/sjonvarp/spila/blaeja-ii/37230/b31m75': `${R}/sjonvarp/spila/blaeja-ii/37230/b31m75`,
    'https://ruv-dl.is/sjonvarp/spila/show/37230?ep=b31m75': `${R}/sjonvarp/spila/show/37230?ep=b31m75`,
    'https://ruv-dl.is/https://www.ruv.is/sjonvarp/spila/x/1/a': `${R}/sjonvarp/spila/x/1/a`,
    'https://ruv-dl.is/www.ruv.is/utvarp/spila/x/1/a': `${R}/utvarp/spila/x/1/a`,
    'https://thrkll.github.io/ruv-dl/krakkaruv/spila/x/1/a': `${R}/krakkaruv/spila/x/1/a`,
    'https://ruv-dl.is/': null,
    'https://thrkll.github.io/ruv-dl/': null,
    'https://ruv-dl.is/frettir/innlent': null,
    'not a url': null,
  };
  for (const [href, expected] of Object.entries(cases)) {
    assert.equal(ruvUrlFromLocation(href), expected, href);
  }
});

test('estimateBytes from bandwidth and duration', () => {
  assert.equal(estimateBytes(3862357, 1680), 811094970);  // ~811 MB for 28 min of 1080p
  assert.equal(estimateBytes(0, 1680), null);
  assert.equal(estimateBytes(1000000, undefined), null);
});

test('countryFromTrace and flagEmoji', () => {
  const trace = 'fl=123\nh=1.1.1.1\nip=203.0.113.9\nts=1\nloc=IS\ntls=TLSv1.3\n';
  assert.equal(countryFromTrace(trace), 'IS');
  assert.equal(countryFromTrace('loc=XX\n'), null);
  assert.equal(countryFromTrace('nothing'), null);
  assert.equal(flagEmoji('IS'), '🇮🇸');
  assert.equal(flagEmoji('NO'), '🇳🇴');
  assert.equal(flagEmoji('is'), '');
  assert.equal(flagEmoji(null), '');
});

test('getProgram reports missing or expired episodes as NotFoundError', async () => {
  for (const response of [new Response(null, { status: 404 }),
                          new Response(null, { status: 422 }),
                          new Response(JSON.stringify({ episodes: [] }))]) {
    await assert.rejects(getProgram('1', 'a', { fetchFn: async () => response }), NotFoundError);
  }
});

test('build.mjs writes the site and a 404.html with absolute script paths', () => {
  const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ruvdl-site-'));
  try {
    execFileSync(process.execPath, [path.join(web, 'build.mjs'), out],
                 { env: { ...process.env, BASE_PATH: '/ruv-dl/' } });
    // CNAME (the custom domain) is copied along when the repository has one
    const cname = fs.existsSync(path.join(web, 'CNAME')) ? ['CNAME'] : [];
    assert.deepEqual(fs.readdirSync(out).sort(),
                     ['404.html', ...cname, 'app.js', 'index.html', 'mp4.js', 'ruvdl.js']);
    const page = fs.readFileSync(path.join(out, '404.html'), 'utf8');
    assert.match(page, /<script type="module" src="\/ruv-dl\/app\.js"><\/script>/);
    assert.match(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), /src="app\.js"/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
