// ruv-dl web: page logic. Core download code lives in ruvdl.js.
import {
  parseRuvUrl, getProgram, getEpisodeList, parseMaster, isMediaPlaylist,
  downloadHls, vttToSrt, fileTitle, GeoblockError,
} from './ruvdl.js';

const $ = id => document.getElementById(id);
const els = {
  form: $('lookup'), url: $('url'), find: $('find'), lookupStatus: $('lookup-status'),
  program: $('program'), image: $('image'), title: $('title'), description: $('description'),
  episodeField: $('episode-field'), episode: $('episode'), quality: $('quality'),
  subs: $('subs'), subsLabel: $('subs-label'),
  download: $('download'), cancel: $('cancel'),
  progress: $('progress'), bar: $('bar'), status: $('status'), memoryNote: $('memory-note'),
};

const canSaveToDisk = typeof window.showSaveFilePicker === 'function';
const state = { programId: null, program: null, episode: null, variants: [], busy: false, abort: null };

function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.className = `status ${kind}`.trim();
}

function formatBytes(n) {
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`;
}

function formatTime(seconds) {
  if (!isFinite(seconds)) return '…';
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return m ? `${m} min ${s} s` : `${s} s`;
}

// ---------- Looking up a program ----------

els.form.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy) return;
  const { programId, episodeId } = parseRuvUrl(els.url.value);
  if (!programId) {
    setStatus(els.lookupStatus, 'That does not look like a ruv.is player link.', 'error');
    return;
  }
  els.find.disabled = true;
  els.program.hidden = true;
  setStatus(els.lookupStatus, 'Looking up…');
  try {
    // The episode list is optional: a single episode still works without it
    let episodes = [];
    try { episodes = await getEpisodeList(programId); } catch { /* ignore */ }

    const firstId = episodeId || episodes[episodes.length - 1]?.id;
    if (!firstId) throw new Error('Could not find an episode in that link.');

    state.programId = programId;
    await loadEpisode(firstId);
    renderEpisodeList(episodes, state.episode.id);
    setStatus(els.lookupStatus, '');
    els.program.hidden = false;
  } catch (err) {
    setStatus(els.lookupStatus, friendlyError(err), 'error');
  } finally {
    els.find.disabled = false;
  }
});

async function loadEpisode(episodeId) {
  const program = await getProgram(state.programId, episodeId);
  const episode = program.episodes[0];
  state.program = program;
  state.episode = episode;

  els.title.textContent = program.title;
  els.description.textContent = (program.description || []).join(' ');
  els.image.src = episode.image || program.image || '';
  els.image.alt = program.title;

  els.subs.disabled = !episode.subtitles_url;
  els.subs.checked = !!episode.subtitles_url;
  els.subsLabel.textContent = episode.subtitles_url
    ? 'Icelandic subtitles (.srt)' : 'No subtitles for this episode';

  await loadQualities(episode.file);
  setStatus(els.status, '');
  els.progress.hidden = true;
}

async function loadQualities(fileUrl) {
  els.quality.innerHTML = '';
  state.variants = [];
  const isHls = new URL(fileUrl).pathname.toLowerCase().endsWith('.m3u8');

  if (!isHls) {
    state.variants = [{ url: fileUrl, label: 'Original file', direct: true }];
  } else {
    const res = await fetch(fileUrl);
    if (res.status === 403) throw new GeoblockError();
    if (!res.ok) throw new Error(`Could not load the stream (${res.status}).`);
    const text = await res.text();
    state.variants = isMediaPlaylist(text)
      ? [{ url: fileUrl, label: 'Best available' }]
      : parseMaster(text, fileUrl);
  }
  if (!state.variants.length) throw new Error('No downloadable stream found.');

  for (const [i, v] of state.variants.entries()) {
    els.quality.add(new Option(i === 0 ? `${v.label} (best)` : v.label, String(i)));
  }
  els.quality.disabled = state.variants.length < 2;
}

function renderEpisodeList(episodes, currentId) {
  els.episode.innerHTML = '';
  if (!episodes.some(e => e.id === currentId)) {
    episodes = [...episodes, { id: currentId, title: state.episode.title }];
  }
  for (const e of episodes) {
    const label = e.number && !String(e.title).includes(String(e.number))
      ? `${e.number}. ${e.title}` : e.title;
    els.episode.add(new Option(label || e.id, e.id, false, e.id === currentId));
  }
  els.episodeField.hidden = episodes.length < 2;
}

els.episode.addEventListener('change', async () => {
  if (state.busy) return;
  els.download.disabled = true;
  setStatus(els.status, 'Loading episode…');
  try {
    await loadEpisode(els.episode.value);
  } catch (err) {
    setStatus(els.status, friendlyError(err), 'error');
  } finally {
    els.download.disabled = false;
  }
});

// ---------- Downloading ----------

// Where the file goes: straight to disk (Chrome/Edge) or memory, then a normal download
async function openWriter(filename, mime) {
  if (canSaveToDisk) {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: 'Video', accept: { [mime]: ['.' + filename.split('.').pop()] } }],
    });
    const stream = await handle.createWritable();
    return {
      write: chunk => stream.write(chunk),
      finish: () => stream.close(),
      abort: () => stream.abort().catch(() => {}),
    };
  }
  const chunks = [];
  return {
    write: async chunk => { chunks.push(chunk); },
    finish: async () => saveBlob(new Blob(chunks, { type: mime }), filename),
    abort: async () => { chunks.length = 0; },
  };
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function downloadDirect(url, write, onProgress, signal) {
  const res = await fetch(url, { signal });
  if (res.status === 403) throw new GeoblockError();
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await write(value);
    bytes += value.length;
    onProgress({ done: bytes, total: total || bytes, bytes });
  }
}

els.download.addEventListener('click', async () => {
  if (state.busy) return;
  const variant = state.variants[Number(els.quality.value) || 0];
  const name = fileTitle(state.program, state.episode);
  const ext = variant.direct ? (new URL(variant.url).pathname.split('.').pop() || 'mp4') : 'mp4';
  const filename = `${name}.${ext}`;

  let writer;
  try {
    // Must happen right after the click, before any other waiting
    writer = await openWriter(filename, variant.direct ? 'application/octet-stream' : 'video/mp4');
  } catch (err) {
    if (err.name === 'AbortError') return;  // user closed the save dialog
    setStatus(els.status, friendlyError(err), 'error');
    return;
  }

  state.busy = true;
  state.abort = new AbortController();
  setBusy(true);
  const started = performance.now();

  const onProgress = ({ done, total, bytes }) => {
    const fraction = total ? done / total : 0;
    els.bar.style.width = `${(fraction * 100).toFixed(1)}%`;
    const elapsed = (performance.now() - started) / 1000;
    const eta = fraction > 0.02 ? elapsed / fraction - elapsed : Infinity;
    setStatus(els.status, `${Math.floor(fraction * 100)}% · ${formatBytes(bytes)} · about ${formatTime(eta)} left`);
  };

  try {
    if (variant.direct) {
      await downloadDirect(variant.url, writer.write, onProgress, state.abort.signal);
    } else {
      await downloadHls(variant.url, {
        muxjs: window.muxjs, write: writer.write, onProgress, signal: state.abort.signal,
      });
    }
    await writer.finish();

    if (els.subs.checked && state.episode.subtitles_url) {
      setStatus(els.status, 'Downloading subtitles…');
      const vtt = await (await fetch(state.episode.subtitles_url)).text();
      saveBlob(new Blob([vtt.includes('-->') ? vttToSrt(vtt) : vtt], { type: 'text/plain' }), `${name}.srt`);
    }

    const took = formatTime((performance.now() - started) / 1000);
    els.bar.style.width = '100%';
    setStatus(els.status, `Done: ${filename} (${took})`, 'ok');
  } catch (err) {
    await writer.abort();
    if (state.abort.signal.aborted) {
      setStatus(els.status, 'Download cancelled.');
    } else {
      setStatus(els.status, friendlyError(err), 'error');
    }
  } finally {
    state.busy = false;
    setBusy(false);
  }
});

els.cancel.addEventListener('click', () => state.abort?.abort());

function setBusy(busy) {
  els.download.hidden = busy;
  els.cancel.hidden = !busy;
  els.episode.disabled = busy;
  els.quality.disabled = busy || state.variants.length < 2;
  els.subs.disabled = busy || !state.episode?.subtitles_url;
  els.find.disabled = busy;
  els.progress.hidden = false;
  els.memoryNote.hidden = !busy || canSaveToDisk;
  if (busy) els.bar.style.width = '0';
}

window.addEventListener('beforeunload', event => {
  if (state.busy) event.preventDefault();
});

function friendlyError(err) {
  if (err instanceof GeoblockError) {
    return 'RÚV refused the download. This content is probably only available in Iceland.';
  }
  if (err instanceof TypeError && /fetch/i.test(err.message)) {
    return 'Could not reach RÚV. Check your connection and try again.';
  }
  return err.message || String(err);
}

// Allow ?url=… links, e.g. from a bookmarklet
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  els.url.value = preset;
  els.form.requestSubmit();
}
