// Run with: node --test web/test/   (Node 18+, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRuvUrl, sanitize, fileTitle, parseMaster, parseMedia, isMediaPlaylist,
  downloadHls, vttToSrt, getEpisodeList, GeoblockError, UnsupportedError,
} from '../ruvdl.js';

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

// Fake mux.js: every pushed segment becomes [init?] + "out:<segment bytes>"
function fakeMux() {
  return {
    mp4: {
      Transmuxer: class {
        constructor() { this.handlers = []; this.buffered = []; }
        on(_event, fn) { this.handlers.push(fn); }
        push(bytes) { this.buffered.push(bytes); }
        flush() {
          for (const b of this.buffered.splice(0)) {
            const data = new TextEncoder().encode('out:' + new TextDecoder().decode(b));
            this.handlers.forEach(fn => fn({ initSegment: new TextEncoder().encode('INIT;'), data }));
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

test('downloadHls writes init once and segments in order', async () => {
  const written = [];
  const progress = [];
  // Make early segments slow so they finish after later ones
  const slowFetch = fakeFetch(segmentRoutes(6));
  const fetchFn = async (url, opts) => {
    if (/segment[01]\.ts$/.test(url)) await new Promise(r => setTimeout(r, 30));
    return slowFetch(url, opts);
  };
  const result = await downloadHls(`${BASE.replace(/[^/]+$/, '')}800/index.m3u8`, {
    muxjs: fakeMux(), fetchFn, write: async c => written.push(new TextDecoder().decode(c)),
    onProgress: p => progress.push(p.done),
  });
  assert.equal(written.join(''),
    'INIT;' + [0, 1, 2, 3, 4, 5].map(i => `out:segment${i}.ts;`).join(''));
  assert.deepEqual(progress, [1, 2, 3, 4, 5, 6]);
  assert.equal(result.duration, 36);
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
    muxjs: fakeMux(), fetchFn, write: async c => written.push(new TextDecoder().decode(c)),
  });
  assert.equal(written.join(''), 'INIT;out:segment0.ts;out:segment1.ts;');
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

test('downloadHls copies fMP4 streams without remuxing', async () => {
  const fetchFn = fakeFetch(url => url.endsWith('.m3u8')
    ? media(2, '#EXT-X-MAP:URI="init.mp4"')
    : new TextEncoder().encode(url.split('/').pop() + ';'));
  const written = [];
  await downloadHls('https://x/v/index.m3u8', {
    muxjs: null, fetchFn, write: async c => written.push(new TextDecoder().decode(c)),
  });
  assert.equal(written.join(''), 'init.mp4;segment0.ts;segment1.ts;');
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

test('getEpisodeList sorts oldest first', async () => {
  const fetchFn = async (url, opts) => {
    assert.equal(JSON.parse(opts.body).variables.id, 37230);
    return new Response(JSON.stringify({ data: { Program: { title: 'x', episodes: [
      { id: 'c', number: 3, title: '3' }, { id: 'a', number: 1, title: '1' },
      { id: 'x', number: null, title: 'Aukaþáttur' }, { id: 'b', number: 2, title: '2' },
    ] } } }));
  };
  const list = await getEpisodeList('37230', { fetchFn });
  assert.deepEqual(list.map(e => e.id), ['a', 'b', 'c', 'x']);
});

test('vttToSrt converts timings, numbering and tags', () => {
  const vtt = `WEBVTT

NOTE a comment

STYLE
::cue { color: yellow }

1
00:00:02.000 --> 00:00:03.080 line:90% align:center
<c.yellow>Hæ.</c> <i>Ég held</i> ég sé næstur.

01:05.5 --> 01:07.25
Tvær
línur
`;
  assert.equal(vttToSrt(vtt),
`1
00:00:02,000 --> 00:00:03,080
Hæ. <i>Ég held</i> ég sé næstur.

2
00:01:05,500 --> 00:01:07,250
Tvær
línur
`);
});
