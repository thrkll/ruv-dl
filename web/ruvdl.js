// ruv-dl web: core logic shared by the page and the Node tests.
// No DOM access here. mux.js is passed in by the caller.

export const REST_API = 'https://api.ruv.is/api/programs/program';
export const GRAPHQL_API = 'https://spilari.nyr.ruv.is/gql/';

export class GeoblockError extends Error {}
export class UnsupportedError extends Error {}

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
  if (res.status === 404 || res.status === 422) {
    throw new Error('Program not found. Check that the link is right.');
  }
  if (!res.ok) throw new Error(`ruv.is answered with ${res.status}.`);
  const data = await res.json();
  if (!data.episodes || !data.episodes.length) {
    throw new Error('This content is not available.');
  }
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

// Variants of a master playlist, best first (resolution, then bandwidth).
export function parseMaster(text, baseUrl) {
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = parseAttributes(lines[i].slice('#EXT-X-STREAM-INF:'.length));
    const uri = lines.slice(i + 1).find(l => l && !l.startsWith('#'));
    if (!uri) continue;
    const [w, h] = (attrs.RESOLUTION || '').split('x').map(Number);
    const bandwidth = Number(attrs['AVERAGE-BANDWIDTH'] || attrs.BANDWIDTH) || 0;
    variants.push({
      url: new URL(uri, baseUrl).href,
      width: w || 0,
      height: h || 0,
      bandwidth,
      label: h ? `${h}p` : 'Audio',
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
  let duration = 0;
  for (const l of lines) {
    if (l.startsWith('#EXTINF:')) duration += parseFloat(l.slice(8)) || 0;
    else if (l && !l.startsWith('#')) segments.push(new URL(l, baseUrl).href);
  }
  return { segments, encrypted, map, duration };
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

// Downloads an HLS variant and writes an MP4 through write(Uint8Array).
// onProgress({ done, total, bytes }) is called after every segment.
export async function downloadHls(variantUrl, {
  muxjs, write, onProgress = () => {}, signal,
  fetchFn = fetch, concurrency = 4,
}) {
  const res = await fetchFn(variantUrl, { signal });
  if (res.status === 403) throw new GeoblockError('RÚV refused the download (403). '
    + 'This content is probably only available in Iceland.');
  if (!res.ok) throw new Error(`Could not load the stream (${res.status}).`);
  const playlist = parseMedia(await res.text(), variantUrl);
  if (playlist.encrypted) throw new UnsupportedError('This stream is encrypted and cannot be downloaded.');
  if (!playlist.segments.length) throw new Error('The stream has no segments.');

  const { segments } = playlist;
  const total = segments.length;
  let bytes = 0;

  // fMP4 streams are already MP4: init segment + fragments, no remuxing
  let transmuxer = null;
  const pendingOut = [];
  let wroteInit = false;
  if (playlist.map) {
    const init = await fetchBytes(playlist.map, { fetchFn, signal });
    await write(init);
    bytes += init.length;
  } else {
    transmuxer = new muxjs.mp4.Transmuxer();
    transmuxer.on('data', seg => {
      if (!wroteInit) {
        pendingOut.push(seg.initSegment);
        wroteInit = true;
      }
      pendingOut.push(seg.data);
    });
  }

  // Fetch a few segments ahead, but process and write strictly in order
  const inflight = new Map();
  const start = i => {
    if (i < total && !inflight.has(i)) {
      const p = fetchBytes(segments[i], { fetchFn, signal });
      p.catch(() => {});  // handled when awaited
      inflight.set(i, p);
    }
  };

  for (let i = 0; i < total; i++) {
    for (let j = i; j < i + concurrency; j++) start(j);
    const data = await inflight.get(i);
    inflight.delete(i);

    if (transmuxer) {
      transmuxer.push(data);
      transmuxer.flush();
      for (const chunk of pendingOut.splice(0)) {
        await write(chunk);
        bytes += chunk.length;
      }
    } else {
      await write(data);
      bytes += data.length;
    }
    onProgress({ done: i + 1, total, bytes });
  }

  if (transmuxer && !wroteInit) {
    throw new UnsupportedError('Could not convert this stream to MP4.');
  }
  return { bytes, duration: playlist.duration };
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
