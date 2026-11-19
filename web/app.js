// ruv-dl web: page logic. Core download code lives in ruvdl.js.
import {
  parseRuvUrl, ruvUrlFromLocation, getProgram, getEpisodeList, parseMaster,
  isMediaPlaylist, downloadHls, getFileExtras, fileTitle, estimateBytes,
  countryFromTrace, flagEmoji, GeoblockError, UnsupportedError, NotFoundError, numbersAreUnique,
} from './ruvdl.js';

const REPO_URL = 'https://github.com/thrkll/ruv-dl';
// The "add -dl to ruv.is" shortcut only works on this domain, so the tip only shows there
const SHORTCUT_DOMAIN = 'ruv-dl.is';

// ---------- Texts ----------

const TEXT = {
  is: {
    lead: 'Sæktu efni af ruv.is beint í vafranum.',
    placeholder: 'https://www.ruv.is/sjonvarp/spila/...',
    urlLabel: 'Hlekkur á efni á ruv.is',
    find: 'Finna',
    step1: 'Finndu efni á ruv.is og afritaðu hlekkinn.',
    step2: 'Límdu hann hér að ofan og veldu Finna.',
    step3: 'Veldu gæði og ýttu á Sækja.',
    tipTitle: 'Flýtileið',
    tipText: 'Ertu á ruv.is? Bættu -dl aftan við ruv í vefslóðinni og þú lendir beint hér, allt klappað og klárt:',
    connectedFrom: 'Þú ert tengd/ur frá:',
    support: 'Viltu að þessi síða verði hér áfram? Það veltur á mínum frítíma og þínum stuðningi.',
    more: 'Meira', less: 'Minna',
    episode: 'Þáttur', quality: 'Gæði', best: 'mestu gæði', about: 'u.þ.b. {size}',
    subsIncluded: 'Íslenskur texti fylgir með í skránni.',
    minutes: '{m} mín', hours: '{h} klst', hoursMinutes: '{h} klst {m} mín',
    availableUntil: 'til {date}', expiresIn: 'rennur út eftir {n} daga', expiresTomorrow: 'rennur út á morgun', expiresToday: 'rennur út í dag',
    allAvailableUntil: 'Allir þættirnir eru aðgengilegir til {date}.',
    allExpiresIn: 'Allir þættirnir renna út eftir {n} daga.',
    allExpiresTomorrow: 'Allir þættirnir renna út á morgun.', allExpiresToday: 'Allir þættirnir renna út í dag.',
    downloaded: 'Sótt', pickMore: 'Fleiri',
    download: 'Sækja', cancel: 'Hætta við', again: 'Sækja eitthvað annað',
    searching: 'Leita…', loadingEpisode: 'Sæki upplýsingar um efnið…',
    progress: '{pct}% · {bytes} · u.þ.b. {eta} eftir',
    preparing: 'Undirbý niðurhal…',
    done: 'Lokið! Vistað sem {file}',
    cancelled: 'Hætt við niðurhal.',
    minSec: '{m} mín {s} sek', sec: '{s} sek',
    memoryNote: 'Vafrinn þinn geymir alla skrána í minni þar til hún er tilbúin. Fyrir langt efni virka Chrome og Edge betur, þeir vista beint á diskinn.',
    iosNote: 'Á iPhone og iPad geta stórar skrár mistekist. Tölva virkar best.',
    errBadLink: 'Þetta lítur ekki út eins og hlekkur á efni á ruv.is.',
    errNotFound: 'Efnið fannst ekki. Það gæti verið útrunnið eða hlekkurinn rangur.',
    errGeoblock: 'RÚV leyfir ekki niðurhal á þessu efni þaðan sem þú tengist. Það er líklega aðeins aðgengilegt á Íslandi.',
    errOffline: 'Engin nettenging.',
    errUnreachable: 'Náði ekki sambandi við RÚV. Ef þetta heldur áfram gæti RÚV hafa lokað á vefútgáfuna, en Python-útgáfan af ruv-dl virkar þá enn.',
    errUnreachableLink: 'Python-útgáfan',
    errUnsupported: 'Ekki er hægt að sækja þetta efni (það er dulkóðað eða á óþekktu sniði).',
    errUnsupportedDetail: 'Ekki er hægt að sækja þetta efni: {message}',
    errGeneric: 'Eitthvað fór úrskeiðis: {message}',
    howItWorks: 'Hvernig virkar þetta?',
    source: 'thrkll/ruv-dl á GitHub',
    switchTo: 'English',
  },
  en: {
    lead: 'Download content from ruv.is straight from your browser.',
    placeholder: 'Paste a link from ruv.is here',
    urlLabel: 'Link to a program on ruv.is',
    find: 'Find',
    step1: 'Find a program on ruv.is and copy the link.',
    step2: 'Paste it above and press Find.',
    step3: 'Pick a quality, then press Download.',
    tipTitle: 'Shortcut',
    tipText: 'On ruv.is? Add -dl after ruv in the address and you land right here, ready to download:',
    connectedFrom: 'You are connecting from:',
    support: 'Want to help keep this project going?',
    more: 'More', less: 'Less',
    episode: 'Episode', quality: 'Quality', best: 'best', about: 'about {size}',
    subsIncluded: 'Icelandic subtitles are included in the file.',
    minutes: '{m} min', hours: '{h} h', hoursMinutes: '{h} h {m} min',
    availableUntil: 'until {date}', expiresIn: 'leaves in {n} days', expiresTomorrow: 'leaves tomorrow', expiresToday: 'leaves today',
    allAvailableUntil: 'All episodes are available until {date}.',
    allExpiresIn: 'All episodes leave ruv.is in {n} days.',
    allExpiresTomorrow: 'All episodes leave ruv.is tomorrow.', allExpiresToday: 'All episodes leave ruv.is today.',
    downloaded: 'Downloaded', pickMore: 'More',
    download: 'Download', cancel: 'Cancel', again: 'Download something else',
    searching: 'Looking up…', loadingEpisode: 'Loading…',
    progress: '{pct}% · {bytes} · about {eta} left',
    preparing: 'Getting ready…',
    done: 'Done! Saved as {file}',
    cancelled: 'Download cancelled.',
    minSec: '{m} min {s} s', sec: '{s} s',
    memoryNote: 'Your browser keeps the whole file in memory until it is finished. For long programs, Chrome or Edge work better: they save straight to disk.',
    iosNote: 'On iPhone and iPad, large files may fail. A computer works best.',
    errBadLink: 'That does not look like a link to something on ruv.is.',
    errNotFound: 'Not found. It may have expired, or the link is wrong.',
    errGeoblock: 'RÚV does not allow downloading this from where you are connecting. It is probably only available in Iceland.',
    errOffline: 'No internet connection.',
    errUnreachable: 'Could not reach RÚV. If this keeps happening, RÚV may have blocked the web version, but the Python version of ruv-dl still works.',
    errUnreachableLink: 'Python version',
    errUnsupported: 'This content cannot be downloaded (it is encrypted or in an unknown format).',
    errUnsupportedDetail: 'This content cannot be downloaded: {message}',
    errGeneric: 'Something went wrong: {message}',
    howItWorks: 'How does this work?',
    source: 'thrkll/ruv-dl on GitHub',
    switchTo: 'Íslenska',
  },
};

let lang = 'is';
try { if (localStorage.getItem('lang') === 'en') lang = 'en'; } catch { /* storage unavailable */ }

function t(key, vars = {}) {
  return (TEXT[lang][key] ?? TEXT.is[key] ?? key)
    .replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
}

// ---------- Elements and state ----------

const $ = id => document.getElementById(id);
const els = {
  lang: $('lang'), conn: $('conn'), connFlag: $('conn-flag'),
  form: $('lookup'), url: $('url'), find: $('find'), lookupStatus: $('lookup-status'),
  howto: $('howto'), tip: $('tip'), tipUrl: $('tip-url'),
  program: $('program'), image: $('image'), title: $('title'), description: $('description'),
  more: $('more'),
  episodeField: $('episode-field'), episodes: $('episodes'), episodesExpiry: $('episodes-expiry'),
  qualityField: $('quality-field'),
  subsNote: $('subs-note'),
  download: $('download'), cancel: $('cancel'), again: $('again'), home: $('home'),
  progress: $('progress'), bar: $('bar'), status: $('status'),
  memoryNote: $('memory-note'), iosNote: $('ios-note'), coffee: $('coffee'),
};

const canSaveToDisk = typeof window.showSaveFilePicker === 'function';
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const state = {
  programId: null, program: null, episode: null, episodes: [], variants: [],
  quality: 0, busy: false, done: false, abort: null, country: null,
};

// ---------- Formatting ----------

function locale() { return lang === 'is' ? 'is-IS' : 'en-GB'; }

function formatBytes(n) {
  const fmt = (v, d) => new Intl.NumberFormat(locale(), { maximumFractionDigits: d }).format(v);
  return n >= 1e9 ? `${fmt(n / 1e9, 1)} GB` : `${fmt(n / 1e6, 0)} MB`;
}

function formatTime(seconds) {
  if (!isFinite(seconds)) return '…';
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return m ? t('minSec', { m, s }) : t('sec', { s });
}

// ---------- Status messages (kept as keys so they follow language changes) ----------

function setStatus(el, key, vars = {}, kind = '') {
  el._message = key ? { key, vars, kind } : null;
  renderStatus(el);
}

function renderStatus(el) {
  const msg = el._message;
  el.className = `status ${msg?.kind || ''}`.trim();
  el.replaceChildren();
  if (!msg) return;
  const text = t(msg.key, typeof msg.vars === 'function' ? msg.vars() : msg.vars);
  // The "RÚV unreachable" error links to the Python version
  const linkText = msg.key === 'errUnreachable' ? t('errUnreachableLink') : null;
  const at = linkText ? text.indexOf(linkText) : -1;
  if (at === -1) {
    el.textContent = text;
  } else {
    const a = Object.assign(document.createElement('a'), { href: REPO_URL, textContent: linkText });
    el.append(text.slice(0, at), a, text.slice(at + linkText.length));
  }
}

function showError(el, err) {
  if (err instanceof GeoblockError) return setStatus(el, 'errGeoblock', {}, 'error');
  if (err instanceof NotFoundError) return setStatus(el, 'errNotFound', {}, 'error');
  if (err instanceof UnsupportedError) {
    // mp4.js and ruvdl.js say why (gap, format change, encryption); keep that for bug reports
    return err.message ? setStatus(el, 'errUnsupportedDetail', { message: err.message }, 'error')
      : setStatus(el, 'errUnsupported', {}, 'error');
  }
  if (err instanceof TypeError) {
    // fetch() fails with a TypeError when offline or when RÚV blocks other sites
    return setStatus(el, navigator.onLine === false ? 'errOffline' : 'errUnreachable', {}, 'error');
  }
  return setStatus(el, 'errGeneric', { message: err?.message || String(err) }, 'error');
}

// ---------- Language ----------

function applyLanguage() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
  for (const el of document.querySelectorAll('[data-i18n-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  }
  // Longer texts are written out per language in the page itself
  for (const el of document.querySelectorAll('[data-lang-block]')) el.hidden = el.dataset.langBlock !== lang;
  els.lang.textContent = t('switchTo');
  els.lang.lang = lang === 'is' ? 'en' : 'is';
  document.querySelector('meta[name="description"]').content = t('lead');
  els.more.textContent = t(els.more.getAttribute('aria-expanded') === 'true' ? 'less' : 'more');
  renderConnection();
  if (state.episode) {
    renderQualities(state.quality);
    renderEpisodeList();
  }
  renderStatus(els.lookupStatus);
  renderStatus(els.status);
}

els.lang.addEventListener('click', () => {
  lang = lang === 'is' ? 'en' : 'is';
  try { localStorage.setItem('lang', lang); } catch { /* storage unavailable */ }
  applyLanguage();
});

// ---------- Where the visitor connects from ----------

async function checkConnection() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://1.1.1.1/cdn-cgi/trace', { cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    state.country = countryFromTrace(await res.text());
  } catch {
    state.country = null;  // the general geoblock message still shows
  }
  renderConnection();
}

// Chrome ships without Icelandic country names, so the likely ones are listed here
const COUNTRIES_IS = {
  IS: 'Ísland', NO: 'Noregur', DK: 'Danmörk', SE: 'Svíþjóð', FI: 'Finnland', FO: 'Færeyjar',
  GL: 'Grænland', DE: 'Þýskaland', GB: 'Bretland', IE: 'Írland', NL: 'Holland', BE: 'Belgía',
  LU: 'Lúxemborg', FR: 'Frakkland', ES: 'Spánn', PT: 'Portúgal', IT: 'Ítalía', CH: 'Sviss',
  AT: 'Austurríki', PL: 'Pólland', CZ: 'Tékkland', HU: 'Ungverjaland', RO: 'Rúmenía',
  GR: 'Grikkland', HR: 'Króatía', EE: 'Eistland', LV: 'Lettland', LT: 'Litháen', UA: 'Úkraína',
  TR: 'Tyrkland', US: 'Bandaríkin', CA: 'Kanada', MX: 'Mexíkó', BR: 'Brasilía',
  AU: 'Ástralía', NZ: 'Nýja-Sjáland', JP: 'Japan', KR: 'Suður-Kórea', CN: 'Kína',
  HK: 'Hong Kong', SG: 'Singapúr', IN: 'Indland', TH: 'Taíland', ZA: 'Suður-Afríka',
};

function countryName(code) {
  if (lang === 'is' && COUNTRIES_IS[code]) return COUNTRIES_IS[code];
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || code; } catch { return code; }
}

// Footer: "Tenging þín er frá: 🇮🇸 Ísland"
function renderConnection() {
  const code = state.country;
  els.conn.hidden = !code;
  if (!code) return;
  els.connFlag.textContent = `${flagEmoji(code)} ${countryName(code)}`;
}

// ---------- Looking up a program ----------

els.form.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy) return;
  await lookup(els.url.value);
});

async function lookup(link) {
  const { programId, episodeId } = parseRuvUrl(link);
  if (!programId) {
    setStatus(els.lookupStatus, 'errBadLink', {}, 'error');
    return;
  }
  els.find.disabled = true;
  els.program.hidden = true;
  setPageTitle();
  els.tip.hidden = true;
  setStatus(els.lookupStatus, 'searching');
  try {
    // The episode list is optional: a single episode still works without it
    let episodes = [];
    try { episodes = await getEpisodeList(programId); } catch { /* ignore */ }

    const firstId = episodeId || episodes[episodes.length - 1]?.id;
    if (!firstId) throw new NotFoundError();

    state.programId = programId;
    state.episodes = episodes;
    await loadEpisode(firstId);
    renderEpisodeList();
    episodePicker.setOpen(false);
    setStatus(els.lookupStatus, null);
    els.howto.hidden = true;
    els.program.hidden = false;
    setPageTitle();
    showTip(link);
    updateDescriptionToggle();
  } catch (err) {
    showError(els.lookupStatus, err);
  } finally {
    els.find.disabled = false;
  }
}

async function loadEpisode(episodeId) {
  const program = await getProgram(state.programId, episodeId);
  const episode = program.episodes[0];
  await loadQualities(episode.file, Number(episode.duration));
  state.program = program;
  state.episode = episode;

  els.title.textContent = program.title;
  setPageTitle();
  els.description.textContent = (program.description || []).join(' ');
  setDescriptionExpanded(false);

  const image = episode.image || program.image;
  els.image.hidden = !image;
  if (image) {
    els.image.src = image;
    els.image.alt = program.title;
  }

  // Subtitles always go into the file; this just says so
  els.subsNote.hidden = !episode.subtitles_url;
  resetProgress();
}

els.image.addEventListener('error', () => { els.image.hidden = true; });

// The tab shows the program, with download progress in front: "42% · Blæja"
function setPageTitle(mark = 'ruv-dl') {
  const name = els.program.hidden ? null : state.program?.title;
  document.title = name ? `${mark} · ${name}` : 'ruv-dl';
}

async function loadQualities(fileUrl, duration) {
  const isHls = new URL(fileUrl).pathname.toLowerCase().endsWith('.m3u8');
  let variants;
  if (!isHls) {
    variants = [{ url: fileUrl, direct: true, height: 0, bandwidth: 0 }];
  } else {
    const res = await fetch(fileUrl);
    if (res.status === 403) throw new GeoblockError();
    if (res.status === 404) throw new NotFoundError();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    variants = isMediaPlaylist(text)
      ? [{ url: fileUrl, height: 0, bandwidth: 0 }]
      : parseMaster(text, fileUrl);
  }
  if (!variants.length) throw new UnsupportedError();
  for (const v of variants) v.bytes = estimateBytes(v.bandwidth, duration);
  state.variants = variants;
  renderQualities(0);
}

function renderQualities(selected) {
  state.quality = selected;
  const items = state.variants.map((v, i) => {
    const name = v.direct ? 'Original' : v.height ? `${v.height}p` : (lang === 'is' ? 'Hljóð' : 'Audio');
    const meta = el('span', 'ep-meta');
    const parts = [v.bytes && t('about', { size: formatBytes(v.bytes) }), i === 0 && state.variants.length > 1 && t('best')]
      .filter(Boolean).map(text => el('span', '', text));
    parts.forEach((part, k) => meta.append(...(k ? [' · ', part] : [part])));
    const main = el('span', 'ep-main');
    main.append(el('span', 'ep-title', name), meta);
    return { value: String(i), parts: () => [main.cloneNode(true)], current: i === selected };
  });
  qualityPicker.render(items);
}

// ---------- Episode list ----------

// Episodes downloaded in this browser ("programId/episodeId"), so the list can mark them.
// Only kept in localStorage; never sent anywhere.
const DOWNLOADED_KEY = 'downloaded';
function downloadedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(DOWNLOADED_KEY)) || []); } catch { return new Set(); }
}
function markDownloaded(programId, episodeId) {
  const key = `${programId}/${episodeId}`;
  try {
    const keys = [...downloadedSet()].filter(k => k !== key);
    keys.push(key);
    localStorage.setItem(DOWNLOADED_KEY, JSON.stringify(keys.slice(-1000)));
  } catch { /* storage unavailable */ }
}

// Chrome ships without Icelandic month names
const MONTHS_IS = ['jan.', 'feb.', 'mars', 'apr.', 'maí', 'júní', 'júlí', 'ágú.', 'sep.', 'okt.', 'nóv.', 'des.'];

// '2026-11-15T21:00:00' -> '15. nóv. 2026' / '15 Nov 2026' (no year for this year's dates)
function formatDate(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const withYear = year !== new Date().getFullYear();
  if (lang === 'is') return `${day}. ${MONTHS_IS[month - 1]}${withYear ? ` ${year}` : ''}`;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...(withYear && { year: 'numeric' }), timeZone: 'UTC' })
    .format(Date.UTC(year, month - 1, day));
}

// 2899 -> '48 mín'; 5520 -> '1 klst 32 mín'
function formatDuration(seconds) {
  const total = Math.round(Number(seconds) / 60);
  if (!(total > 0)) return null;
  const h = Math.floor(total / 60), m = total % 60;
  return h ? t(m ? 'hoursMinutes' : 'hours', { h, m }) : t('minutes', { m });
}

// Days until an episode leaves ruv.is, or null if it stays ('9999-12-31')
function daysLeft(expires) {
  const m = String(expires || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || Number(m[1]) >= 9000) return null;
  return Math.ceil((Date.UTC(m[1], m[2] - 1, m[3]) - Date.now()) / 86_400_000);
}

const EXPIRING_DAYS = 30;   // shown in red from here
const SHOW_EXPIRY_DAYS = 365;  // further away than this is not worth mentioning

// "rennur út eftir 12 daga" (soon) or "til 17. maí 2027"; all = said of every episode at once
function expiryText(expires, all = false) {
  const left = daysLeft(expires);
  if (left === null || left < 0 || left > SHOW_EXPIRY_DAYS) return null;
  const soon = left <= EXPIRING_DAYS;
  const key = !soon ? 'availableUntil' : left === 0 ? 'expiresToday' : left === 1 ? 'expiresTomorrow' : 'expiresIn';
  return { soon, text: t(all ? `all${key[0].toUpperCase()}${key.slice(1)}` : key, { n: left, date: formatDate(expires) }) };
}

const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text ?? '' });

// Number, title, "date · length · expiry" and "✓ Sótt" for one episode
function episodeParts(e, { showNumbers, sharedExpiry, downloaded }) {
  const meta = el('span', 'ep-meta');
  // Some shows use the date as the title ("28. okt. 2026"); then it is not repeated
  const titleIsDate = /\b(19|20)\d\d\b/.test(e.title || '');
  // Each part stays on one line; lines may only break between them
  const parts = [titleIsDate ? null : formatDate(e.firstrun), formatDuration(e.duration)]
    .filter(Boolean).map(text => el('span', '', text));
  const expiry = !sharedExpiry && expiryText(e.file_expires);
  if (expiry) parts.push(el('span', expiry.soon ? 'soon' : '', expiry.text));
  parts.forEach((part, i) => meta.append(...(i ? [' · ', part] : [part])));
  const main = el('span', 'ep-main');
  main.append(el('span', 'ep-title', e.title || e.id), meta);
  return [
    ...(showNumbers ? [el('span', 'ep-num', e.number ?? '')] : []),
    main,
    ...(downloaded.has(`${state.programId}/${e.id}`) ? [el('span', 'ep-done', `✓ ${t('downloaded')}`)] : []),
  ];
}

// A picker: the chosen item on one row, with "Fleiri ▾" opening every choice
// below it. Used for episodes and qualities; onPick(value) runs when another
// item is picked.
function makePicker(field, onPick) {
  const toggle = field.querySelector('.pick-current');
  const row = field.querySelector('.pick-row');
  const list = field.querySelector('.pick-list');
  const setOpen = open => {
    list.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => {
    const open = list.hidden;
    setOpen(open);
    if (open) list.querySelector('[aria-current]')?.focus();
  });
  // Escape closes the list and goes back to the button that opened it
  field.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || list.hidden) return;
    setOpen(false);
    toggle.focus();
  });
  list.addEventListener('click', event => {
    const item = event.target.closest('.pick-item');
    if (!item || state.busy) return;
    setOpen(false);
    toggle.focus();
    if (item.getAttribute('aria-current') !== 'true') onPick(item.value);
  });
  return {
    setOpen,
    // items: [{ value, parts: () => [nodes], current }]
    render(items) {
      row.replaceChildren(...(items.find(i => i.current) || items[0])?.parts() || []);
      list.replaceChildren(...items.map(i => {
        const item = Object.assign(el('button', 'pick-item'), { type: 'button', value: i.value });
        if (i.current) item.setAttribute('aria-current', 'true');
        item.append(...i.parts());
        return item;
      }));
      toggle.disabled = items.length < 2;  // nothing to choose between
      if (items.length < 2) setOpen(false);
    },
  };
}

const episodePicker = makePicker(els.episodeField, async id => {
  els.download.disabled = true;
  setStatus(els.status, 'loadingEpisode');
  try {
    await loadEpisode(id);
    renderEpisodeList();
    setStatus(els.status, null);
    updateDescriptionToggle();
  } catch (err) {
    showError(els.status, err);
  } finally {
    els.download.disabled = false;
  }
});

// Picking another quality after a download starts over
const qualityPicker = makePicker(els.qualityField, value => {
  renderQualities(Number(value));
  if (state.done) resetProgress();
});

// Every episode, newest first
function renderEpisodeList() {
  const current = state.episode;
  let episodes = state.episodes;
  if (!episodes.some(e => e.id === current.id)) episodes = [...episodes, current];
  // Numbers that repeat say nothing, so they are left out (the list is then in air-date order)
  const opts = { showNumbers: numbersAreUnique(episodes), downloaded: downloadedSet() };
  // When every episode leaves on the same day, say it once under the list
  const days = new Set(episodes.map(e => String(e.file_expires || '').slice(0, 10)));
  const shared = days.size === 1 ? expiryText([...days][0], true) : null;
  opts.sharedExpiry = days.size === 1;
  els.episodesExpiry.hidden = !shared;
  els.episodesExpiry.textContent = shared?.text || '';
  els.episodesExpiry.classList.toggle('soon', !!shared?.soon);

  episodePicker.render([...episodes].reverse().map(e => ({
    value: e.id, current: e.id === current.id, parts: () => episodeParts(e, opts),
  })));
  els.episodeField.hidden = episodes.length < 2;
}

// Long descriptions show three lines with a More/Less toggle
function setDescriptionExpanded(expanded) {
  els.description.classList.toggle('clamped', !expanded);
  els.more.setAttribute('aria-expanded', String(expanded));
  els.more.textContent = t(expanded ? 'less' : 'more');
}

function updateDescriptionToggle() {
  setDescriptionExpanded(false);
  els.more.hidden = els.description.scrollHeight <= els.description.clientHeight + 2;
}

els.more.addEventListener('click', () => {
  setDescriptionExpanded(els.more.getAttribute('aria-expanded') !== 'true');
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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  const variant = state.variants[state.quality] || state.variants[0];
  const name = fileTitle(state.program, state.episode);
  const ext = variant.direct ? (new URL(variant.url).pathname.split('.').pop() || 'mp4') : 'mp4';
  const filename = `${name}.${ext}`;

  let writer;
  try {
    // Must happen right after the click, before any other waiting
    writer = await openWriter(filename, variant.direct ? 'application/octet-stream' : 'video/mp4');
  } catch (err) {
    if (err.name === 'AbortError') return;  // user closed the save dialog
    showError(els.status, err);
    return;
  }

  state.abort = new AbortController();
  const { signal } = state.abort;
  setBusy(true);
  let latest = { pct: 0, bytes: 0, eta: Infinity };
  let started;

  const onProgress = ({ done, total, bytes }) => {
    const fraction = total ? done / total : 0;
    els.bar.style.width = `${(fraction * 100).toFixed(1)}%`;
    const elapsed = (performance.now() - started) / 1000;
    const pct = Math.floor(fraction * 100);
    if (pct !== latest.pct) setPageTitle(`${pct}%`);
    latest = { pct, bytes, eta: fraction > 0.02 ? elapsed / fraction - elapsed : Infinity };
    renderStatus(els.status);
  };

  try {
    if (variant.direct) {
      startProgress();
      await downloadDirect(variant.url, writer.write, onProgress, signal);
    } else {
      // Tags, subtitles and cover art go into the file itself
      setStatus(els.status, 'preparing');
      // A number shared with other episodes would give several files the same S01E05
      const episode = numbersAreUnique(state.episodes) ? state.episode : { ...state.episode, number: null };
      const extras = await getFileExtras(state.program, episode, { signal });
      startProgress();
      await downloadHls(variant.url, {
        audioUrl: variant.audio, muxjs: window.muxjs, write: writer.write, onProgress, signal, ...extras,
      });
    }
    await writer.finish();
  } catch (err) {
    await writer.abort();
    if (signal.aborted) {
      setStatus(els.status, 'cancelled');
      setPageTitle();
    } else {
      showError(els.status, err);
      setPageTitle('⚠');
    }
    setBusy(false);
    return;
  }

  setStatus(els.status, 'done', { file: filename }, 'ok');
  setPageTitle('✓');
  markDownloaded(state.programId, state.episode.id);
  renderEpisodeList();
  els.bar.style.width = '100%';
  state.done = true;  // hide Sækja so the only way on is "Sækja eitthvað annað"
  els.again.hidden = false;
  els.coffee.hidden = false;  // the best moment to ask
  setBusy(false);

  function startProgress() {
    started = performance.now();
    setPageTitle('0%');
    setStatus(els.status, 'progress', () => ({
      pct: latest.pct, bytes: formatBytes(latest.bytes), eta: formatTime(latest.eta),
    }));
  }
});

els.cancel.addEventListener('click', () => state.abort?.abort());


// Back to an empty page, ready for the next link
function goHome() {
  state.abort?.abort();  // the header link works mid-download too
  els.program.hidden = true;
  setPageTitle();
  els.tip.hidden = true;
  els.howto.hidden = false;
  els.url.value = '';
  setStatus(els.status, null);
  setStatus(els.lookupStatus, null);
  history.replaceState(null, '', basePath());
  els.url.focus();
}
els.again.addEventListener('click', goHome);

// The ruv-dl header goes to the front page; new-tab clicks keep working as a normal link
els.home.href = basePath();
els.home.addEventListener('click', e => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  goHome();
});

function setBusy(busy) {
  state.busy = busy;
  // The progress bar rolls while downloading
  els.progress.classList.toggle('active', busy);
  els.download.hidden = busy || state.done;
  els.cancel.hidden = !busy;
  if (busy) {
    els.again.hidden = true;
    els.coffee.hidden = true;
  }
  els.episodeField.disabled = busy;
  els.qualityField.disabled = busy;
  if (busy) {
    episodePicker.setOpen(false);
    qualityPicker.setOpen(false);
  }
  els.find.disabled = busy;
  els.url.disabled = busy;
  els.progress.hidden = false;
  els.memoryNote.hidden = !busy || canSaveToDisk;
  els.iosNote.hidden = !isIOS || state.done;
  if (busy) els.bar.style.width = '0';
}

function resetProgress() {
  state.done = false;
  els.download.hidden = false;
  els.progress.hidden = true;
  els.bar.style.width = '0';
  els.again.hidden = true;
  els.coffee.hidden = true;
  els.iosNote.hidden = !isIOS;
  setStatus(els.status, null);
  setPageTitle();
}

window.addEventListener('beforeunload', event => {
  if (state.busy) event.preventDefault();
});

// On ruv-dl.is (and in a local preview) visitors can swap ruv.is for it in any RÚV link
function shortcutWorksHere() {
  const host = location.hostname.replace(/^www\./, '');
  return host === SHORTCUT_DOMAIN || host === 'localhost' || host === '127.0.0.1';
}

// The shortcut section in "Hvernig virkar þetta?" only makes sense where the trick works
if (!shortcutWorksHere()) for (const el of document.querySelectorAll('[data-shortcut]')) el.hidden = true;

// Visitors who came through the shortcut already know it
const arrivedViaShortcut = /\/(?:sjonvarp|utvarp|krakkaruv)\/spila\//.test(location.pathname);

// "Flýtileið" under the content, using the visitor's own link as the example:
// www.ruv.is/sjonvarp/spila/x/1/a  ->  www.ruv-dl.is/sjonvarp/spila/x/1/a
function showTip(link) {
  if (!shortcutWorksHere() || arrivedViaShortcut) return;
  let url;
  const text = link.trim();
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return; }
  if (!/(^|\.)ruv\.is$/.test(url.hostname)) return;
  const before = url.hostname.replace(/ruv\.is$/, 'ruv');
  const mark = Object.assign(document.createElement('mark'), { textContent: '-dl' });
  // Keep "www.ruv-dl.is" on one line; only the path after it may wrap
  const host = Object.assign(document.createElement('span'), { className: 'tip-host' });
  host.append(before, mark, '.is');
  els.tipUrl.replaceChildren(host, `${url.pathname}${url.search}`);
  els.tip.hidden = false;
}

// The site's own root: '/' on a custom domain, '/ruv-dl/' on github.io
function basePath() {
  const script = document.querySelector('script[src$="app.js"]');
  return new URL('.', script ? script.src : location.href).pathname;
}

// ---------- Start ----------

els.iosNote.hidden = !isIOS;
applyLanguage();
checkConnection();

// Opened with a RÚV link? (…?url=…, or a ruv.is path after our domain)
const preset = ruvUrlFromLocation(location.href);
if (preset) {
  els.url.value = preset;
  lookup(preset);
}
