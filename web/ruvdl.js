// ruv-dl web: core logic shared by the page and the Node tests.
// No DOM access here. mux.js is passed in by the caller.

import { createMp4Writer, UnsupportedError } from './mp4.js';

export const REST_API = 'https://api.ruv.is/api/programs/program';
export const GRAPHQL_API = 'https://spilari.nyr.ruv.is/gql/';

export class GeoblockError extends Error {}
export { UnsupportedError };
// Program or episode does not exist (wrong link, or no longer available)
export class NotFoundError extends Error {}

// ---------- URLs and names ----------

// Returns { programId, episodeId } from a ruv.is player link.
//   .../spila/content-name/XXXXX?ep=ZZZZZZ
//   .../spila/content-name/XXXXX/ZZZZZZ
//   .../spila/content-name/XXXXX
export function parseRuvUrl(url) {
  const path = String(url || '').trim()
    .replace('?ep=', '/').split('?')[0].split('#')[0].replace(/\/+$/, '');
  const parts = path.split('/');
  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2];
  if (/^\d+$/.test(last)) return { programId: last, episodeId: null };
  if (/^\d+$/.test(prev || '')) return { programId: prev, episodeId: last };
  return { programId: null, episodeId: null };
}

// The RÚV link a visitor arrived with, if any. Supports
//   ?url=https://www.ruv.is/sjonvarp/spila/…        (bookmarklets, links)
//   /sjonvarp/spila/show/123/abc                     (swap the domain for ours)
//   /https://www.ruv.is/sjonvarp/spila/show/123/abc  (put our domain in front)
export function ruvUrlFromLocation(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  const param = url.searchParams.get('url');
  if (param) return param;
  const match = url.pathname.match(/\/(?:sjonvarp|utvarp|krakkaruv)\/spila\/.+$/);
  return match ? `https://www.ruv.is${match[0]}${url.search}` : null;
}

// Rough file size in bytes: bits per second × seconds / 8
export function estimateBytes(bandwidth, durationSeconds) {
  const bw = Number(bandwidth), secs = Number(durationSeconds);
  return bw > 0 && secs > 0 ? Math.round(bw * secs / 8) : null;
}

// Country code from Cloudflare's /cdn-cgi/trace output ("loc=IS")
export function countryFromTrace(text) {
  const m = String(text || '').match(/^loc=([A-Z]{2})$/m);
  return m && m[1] !== 'XX' ? m[1] : null;
}

// 'IS' -> 🇮🇸
export function flagEmoji(code) {
  if (!/^[A-Z]{2}$/.test(code || '')) return '';
  return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

// Same rule as the Python tool: letters, digits, _ . ( ) space and -
export function sanitize(name) {
  return String(name || '')
    .replace(/[^\p{L}\p{N}_.)( -]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fileTitle(program, episode) {
  const title = program.multiple_episodes && episode.title
    ? `${program.title} - ${episode.title}`
    : program.title;
  return sanitize(title) || 'ruv';
}

// ---------- RÚV APIs ----------

export async function getProgram(programId, episodeId, { fetchFn = fetch } = {}) {
  const res = await fetchFn(`${REST_API}/${programId}/${episodeId}`);
  if (res.status === 404 || res.status === 422) throw new NotFoundError();
  if (!res.ok) throw new Error(`ruv.is answered with ${res.status}.`);
  const data = await res.json();
  if (!data.episodes || !data.episodes.length) throw new NotFoundError();
  return data;
}

// All available episodes, oldest first: [{ id, number, title }]
export async function getEpisodeList(programId, { fetchFn = fetch } = {}) {
  const query = `query getProgram($id: Int!) {
    Program(id: $id) { title episodes { id number title } } }`;
  const res = await fetchFn(GRAPHQL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationName: 'getProgram',
                           variables: { id: Number(programId) }, query }),
  });
  if (!res.ok) throw new Error(`Episode list request failed (${res.status}).`);
  const program = (await res.json())?.data?.Program;
  if (!program) throw new Error('Program not found.');
  const num = e => (/^\d+$/.test(String(e.number ?? '').trim()) ? Number(e.number) : null);
  return (program.episodes || [])
    .filter(e => e && e.id)
    .sort((a, b) => (num(a) === null) - (num(b) === null) || (num(a) ?? 0) - (num(b) ?? 0));
}

// ---------- HLS playlists ----------

function parseAttributes(text) {
  const attrs = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(text))) attrs[m[1]] = m[2].replace(/^"|"$/g, '');
  return attrs;
}

export function isMediaPlaylist(text) {
  return /#EXTINF/.test(text);
}

// Language tags treated as Icelandic when choosing between audio renditions
const ICELANDIC_LANGS = new Set(['is', 'isl', 'ice']);

// Best audio rendition of a group: Icelandic, regular (not audio description),
// marked DEFAULT. Returns its URL, or null when the audio is muxed into the
// variant itself (no rendition URI), which is the case the plain path handles.
function pickAudio(renditions, baseUrl) {
  if (!renditions?.length) return null;
  const rank = r => [
    ICELANDIC_LANGS.has(String(r.LANGUAGE || '').toLowerCase().split('-')[0]),
    !/accessibility/i.test(r.CHARACTERISTICS || ''),
    r.DEFAULT === 'YES',
    !r.URI,  // on a tie, audio already in the variant is the cheaper choice
  ];
  const best = renditions.map((r, i) => ({ r, i, k: rank(r) })).sort((a, b) => {
    for (let j = 0; j < a.k.length; j++) if (a.k[j] !== b.k[j]) return a.k[j] ? -1 : 1;
    return a.i - b.i;
  })[0].r;
  return best.URI ? new URL(best.URI, baseUrl).href : null;
}

// Variants of a master playlist, best first (resolution, then bandwidth).
// variant.audio is the URL of a separate audio playlist, or null when the
// variant's own segments carry the sound.
export function parseMaster(text, baseUrl) {
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const audioGroups = {};
  for (const l of lines) {
    if (!l.startsWith('#EXT-X-MEDIA:')) continue;
    const attrs = parseAttributes(l.slice('#EXT-X-MEDIA:'.length));
    if (attrs.TYPE !== 'AUDIO') continue;
    (audioGroups[attrs['GROUP-ID']] ||= []).push(attrs);
  }
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = parseAttributes(lines[i].slice('#EXT-X-STREAM-INF:'.length));
    const uri = lines.slice(i + 1).find(l => l && !l.startsWith('#'));
    if (!uri) continue;
    const [w, h] = (attrs.RESOLUTION || '').split('x').map(Number);
    const url = new URL(uri, baseUrl).href;
    // An audio-only variant is the sound itself, whatever its group says: its
    // CODECS name no video codec, or it is one of the group's own renditions.
    // A variant with neither RESOLUTION nor CODECS is taken to have video.
    const group = audioGroups[attrs.AUDIO] || [];
    const audioOnly = (!h && attrs.CODECS && !/avc|hvc|hev|av01|vp0/i.test(attrs.CODECS))
      || group.some(r => r.URI && new URL(r.URI, baseUrl).href === url);
    const bandwidth = Number(attrs['AVERAGE-BANDWIDTH'] || attrs.BANDWIDTH) || 0;
    variants.push({
      url,
      width: w || 0,
      height: h || 0,
      bandwidth,
      label: h ? `${h}p` : 'Audio',
      audio: attrs.AUDIO && !audioOnly ? pickAudio(group, baseUrl) : null,
    });
  }
  // Drop exact duplicates, then sort best first
  const seen = new Set();
  const unique = variants.filter(v => !seen.has(v.url) && seen.add(v.url));
  unique.sort((a, b) => b.width * b.height - a.width * a.height || b.bandwidth - a.bandwidth);
  for (const v of unique) {
    const rate = v.bandwidth >= 1e6 ? `${(v.bandwidth / 1e6).toFixed(1)} Mbps`
      : `${Math.round(v.bandwidth / 1e3)} kbps`;
    v.label += v.bandwidth ? ` · ${rate}` : '';
  }
  return unique;
}

// Segments of a media playlist.
export function parseMedia(text, baseUrl) {
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const key = lines.find(l => l.startsWith('#EXT-X-KEY:'));
  const encrypted = !!key && parseAttributes(key.slice(11)).METHOD !== 'NONE';
  const mapLine = lines.find(l => l.startsWith('#EXT-X-MAP:'));
  const map = mapLine ? new URL(parseAttributes(mapLine.slice(11)).URI, baseUrl).href : null;
  const segments = [];
  const starts = [];  // playlist time where each segment begins, in seconds
  let duration = 0;
  let next = 0;  // start of the next segment
  for (const l of lines) {
    if (l.startsWith('#EXTINF:')) duration += parseFloat(l.slice(8)) || 0;
    else if (l && !l.startsWith('#')) {
      starts.push(next);
      segments.push(new URL(l, baseUrl).href);
      next = duration;
    }
  }
  return { segments, starts, encrypted, map, duration };
}

// ---------- Downloading ----------

async function fetchBytes(url, { fetchFn, signal, tries = 4 }) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchFn(url, { signal });
      if (res.status === 403) {
        throw new GeoblockError('RÚV refused the download (403). '
          + 'This content is probably only available in Iceland.');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      if (err instanceof GeoblockError || signal?.aborted || attempt >= tries) throw err;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

const GEOBLOCK_MESSAGE = 'RÚV refused the download (403). '
  + 'This content is probably only available in Iceland.';
const UNCONVERTIBLE = 'Could not convert this stream to MP4.';

async function loadMedia(url, { fetchFn, signal }) {
  const res = await fetchFn(url, { signal });
  if (res.status === 403) throw new GeoblockError(GEOBLOCK_MESSAGE);
  if (!res.ok) throw new Error(`Could not load the stream (${res.status}).`);
  const playlist = parseMedia(await res.text(), url);
  if (playlist.encrypted) throw new UnsupportedError('This stream is encrypted and cannot be downloaded.');
  if (!playlist.segments.length) throw new Error('The stream has no segments.');
  return playlist;
}

// Fetches a few URLs ahead, but hands them to handle(bytes, i) strictly in order
async function fetchInOrder(urls, handle, { fetchFn, signal, concurrency }) {
  const inflight = new Map();
  const start = i => {
    if (i < urls.length && !inflight.has(i)) {
      const p = fetchBytes(urls[i], { fetchFn, signal });
      p.catch(() => {});  // handled when awaited
      inflight.set(i, p);
    }
  };
  for (let i = 0; i < urls.length; i++) {
    for (let j = i; j < i + concurrency; j++) start(j);
    const data = await inflight.get(i);
    inflight.delete(i);
    await handle(data, i);
  }
}

// Downloads an HLS variant and writes a regular MP4 through write(Uint8Array).
// audioUrl is the variant's separate audio playlist, if it has one; the two
// tracks are then merged into one file. onProgress({ done, total, bytes }) is
// called after every segment.
//
// Every source (MPEG-TS through mux.js, or fMP4 as it is) becomes fragments,
// and the fragments' samples go into one MP4 (see mp4.js).
export async function downloadHls(variantUrl, {
  audioUrl = null, muxjs, write, onProgress = () => {}, signal,
  fetchFn = fetch, concurrency = 4,
}) {
  const opts = { fetchFn, signal, concurrency };
  const urls = audioUrl ? [variantUrl, audioUrl] : [variantUrl];
  const playlists = await Promise.all(urls.map(url => loadMedia(url, opts)));

  let bytes = 0;
  const writer = createMp4Writer({ write: async chunk => { await write(chunk); bytes += chunk.length; } });
  // With separate audio, each playlist gives one track; otherwise all of them
  const tracks = playlists.map((playlist, k) => ({
    playlist, handler: audioUrl ? (k ? 'soun' : 'vide') : null,
    feed: trackFeed(playlist, muxjs), src: null,
  }));
  for (const tr of tracks) {
    if (tr.playlist.map) tr.src = writer.addTrack(await fetchBytes(tr.playlist.map, opts), tr.handler);
  }

  // Segments of every playlist in one list, in playback order
  const jobs = tracks
    .flatMap((tr, k) => tr.playlist.segments.map((url, i) => ({ url, k, start: tr.playlist.starts[i] })))
    .sort((a, b) => a.start - b.start || a.k - b.k);

  await fetchInOrder(jobs.map(j => j.url), async (data, i) => {
    const tr = tracks[jobs[i].k];
    for (const { init, data: fragment } of tr.feed(data)) {
      if (!tr.src) {
        if (!init) throw new UnsupportedError(UNCONVERTIBLE);
        tr.src = writer.addTrack(init, tr.handler);
        await writer.addFragment(tr.src, fragment);
      } else {
        await writer.addFragment(tr.src, fragment, init);
      }
    }
    onProgress({ done: i + 1, total: jobs.length, bytes });
  }, opts);

  if (!tracks.every(tr => tr.src)) throw new UnsupportedError(UNCONVERTIBLE);
  await writer.finish();
  return { bytes, duration: playlists[0].duration };
}

// Turns one playlist's segments into MP4 fragments: feed(bytes) -> [{ init, data }]
// (init is null for fMP4 streams, whose init segment is the EXT-X-MAP)
function trackFeed(playlist, muxjs) {
  if (playlist.map) return data => [{ init: null, data }];  // already fMP4
  // Original timestamps keep separate video and audio in sync, and let the
  // writer find mux.js's repeated frames at segment boundaries
  const transmuxer = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: true });
  const segs = [];
  transmuxer.on('data', seg => segs.push(seg));
  return data => {
    transmuxer.push(data);
    transmuxer.flush();
    return segs.splice(0).map(seg => ({ init: seg.initSegment || null, data: seg.data }));
  };
}

// ---------- Subtitles ----------

export function vttToSrt(vtt) {
  const blocks = String(vtt).replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/);
  const out = [];
  const time = t => {
    const parts = t.trim().split(':');
    if (parts.length === 2) parts.unshift('00');
    const [h, m, s] = parts;
    const [sec, ms = '000'] = s.split('.');
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${sec.padStart(2, '0')},${ms.padEnd(3, '0').slice(0, 3)}`;
  };
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim() !== '');
    const idx = lines.findIndex(l => l.includes('-->'));
    if (idx === -1) continue;  // header, NOTE, STYLE, REGION
    const [start, rest] = lines[idx].split('-->');
    const end = rest.trim().split(/\s+/)[0];  // drop cue settings
    const text = lines.slice(idx + 1)
      .map(l => l.replace(/<(?!\/?[biu]>)[^>]+>/g, ''))  // keep <i>, <b>, <u>
      .join('\n');
    if (!text) continue;
    out.push(`${out.length + 1}\n${time(start)} --> ${time(end)}\n${text}\n`);
  }
  return out.join('\n');
}
