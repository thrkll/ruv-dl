"""
HLS stream selection helpers.

Kept free of CLI/argparse state so the logic can be unit tested with mocked
ffprobe output.

How FFmpeg exposes an HLS master playlist (verified against FFmpeg 7.x/8.x):
  * Every #EXT-X-STREAM-INF variant becomes one *program*.
  * A program contains the variant's video stream plus the audio that belongs
    to it: either audio muxed into the variant itself, or every rendition of
    the variant's AUDIO="..." group (#EXT-X-MEDIA), which is then shared by
    all programs referencing that group.
  * ffprobe lists program streams under each program *and* again in the
    top-level stream list, so the same stream index shows up several times.
"""

import json
import subprocess
from urllib.parse import urlparse

# Language tags treated as Icelandic when choosing between audio renditions
ICELANDIC_LANGS = {'is', 'isl', 'ice', 'icelandic', 'íslenska', 'islenska'}

# Dispositions marking accessibility/commentary tracks we should not pick
# over a regular programme audio track
_SECONDARY_DISPOSITIONS = ('visual_impaired', 'hearing_impaired', 'comment',
                           'descriptions')


def is_hls_url(url: str) -> bool:
    """True if the URL points at an .m3u8 playlist, ignoring query/fragment."""
    if not url:
        return False
    return urlparse(url).path.lower().endswith('.m3u8')


def probe_hls(content_url: str):
    """
    Run ffprobe and return its parsed JSON (programs + streams).
    Raises RuntimeError with ffprobe's message on failure.
    """
    cmd = [
        'ffprobe',
        '-v', 'error',
        '-show_programs',
        '-show_streams',
        '-of', 'json',
        content_url,
    ]
    process = subprocess.Popen(cmd,
                               stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE,
                               universal_newlines=True,
                               encoding='utf-8',
                               errors='replace')
    out, err = process.communicate()
    if process.returncode != 0:
        msg = (err or '').strip().splitlines()
        raise RuntimeError(msg[-1] if msg else
                           f'ffprobe exited with code {process.returncode}')
    try:
        return json.loads(out or '{}')
    except ValueError as e:
        raise RuntimeError(f'could not parse ffprobe output ({e})')


def _to_int(value, default=0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _bitrate(stream: dict, programs: list) -> int:
    """Best-effort bitrate for a stream; 0 if unknown. Never required."""
    tags = stream.get('tags') or {}
    rate = _to_int(tags.get('variant_bitrate'))
    if not rate:
        rate = max((_to_int((p.get('tags') or {}).get('variant_bitrate'))
                    for p in programs), default=0)
    if not rate:
        rate = _to_int(stream.get('bit_rate'))
    return rate


def _collect(probe: dict):
    """
    Returns (streams, programs):
      streams  -- {index: stream_dict}, deduplicated across program/top-level
      programs -- list of (program_dict, set_of_stream_indices)
    """
    streams = {}
    programs = []

    def add(s):
        idx = s.get('index')
        if not isinstance(idx, int):
            idx = _to_int(idx, None)
        if idx is None:
            return None
        merged = streams.setdefault(idx, {})
        # Merge so partially populated duplicates complement each other
        for k, v in s.items():
            if v not in (None, '', {}) and k not in merged:
                merged[k] = v
        merged['index'] = idx
        return idx

    for s in probe.get('streams') or []:
        add(s)
    for p in probe.get('programs') or []:
        members = set()
        for s in p.get('streams') or []:
            idx = add(s)
            if idx is not None:
                members.add(idx)
        programs.append((p, members))
    return streams, programs


def _audio_rank(stream: dict, programs: list):
    """Sort key (higher is better) for choosing between audio renditions."""
    tags = stream.get('tags') or {}
    disp = stream.get('disposition') or {}
    secondary = any(_to_int(disp.get(d)) for d in _SECONDARY_DISPOSITIONS)
    lang = str(tags.get('language', '')).strip().lower()
    return (
        not secondary,                  # regular programme audio first
        lang in ICELANDIC_LANGS,        # Icelandic (incl. dubbed) next
        bool(_to_int(disp.get('default'))),  # playlist DEFAULT=YES
        _bitrate(stream, programs),     # better quality
        -stream['index'],               # deterministic tie-break
    )


def _pick_audio(candidates, streams, programs):
    if not candidates:
        return None
    return max(candidates,
               key=lambda i: _audio_rank(streams[i],
                                         [p for p, m in programs if i in m]))


def select_streams(probe: dict, resolution_index: int):
    """
    Choose (video_index, audio_index) from parsed ffprobe output.

    resolution_index is 0-based: 0 = best, 1 = second-best, 2 = third-best,
    clamped to the number of distinct video variants. Variants are ranked by
    pixel count, then (if known) bitrate. Either value may be None.
    """
    streams, programs = _collect(probe)

    videos = [i for i, s in streams.items() if s.get('codec_type') == 'video'
              and not _to_int((s.get('disposition') or {}).get('attached_pic'))]
    audios = [i for i, s in streams.items() if s.get('codec_type') == 'audio']

    def programs_of(i):
        return [p for p, members in programs if i in members]

    video_idx = None
    if videos:
        ranked = {}
        for i in videos:
            s = streams[i]
            w, h = _to_int(s.get('width')), _to_int(s.get('height'))
            key = (w * h, _bitrate(s, programs_of(i)))
            # Collapse identical renditions so -r 2/3 move to *distinct* ones;
            # the lowest stream index wins for determinism
            if key not in ranked or i < ranked[key]:
                ranked[key] = i
        order = sorted(ranked.items(), key=lambda kv: (kv[0], -kv[1]),
                       reverse=True)
        pos = min(max(resolution_index, 0), len(order) - 1)
        video_idx = order[pos][1]

    audio_idx = None
    if audios:
        if video_idx is not None:
            # Audio that belongs to the selected variant (muxed or its group)
            related = set()
            for _, members in programs:
                if video_idx in members:
                    related |= members
            candidates = [i for i in audios if i in related]
            # No program info linking audio to this video: fall back to all
            audio_idx = _pick_audio(candidates or audios, streams, programs)
        else:
            audio_idx = _pick_audio(audios, streams, programs)

    return video_idx, audio_idx


def build_map_args(video_idx, audio_idx) -> list:
    """
    Translate a selection into ffmpeg -map arguments.

    An explicit -map disables ffmpeg's automatic selection for *all* media
    types, so we never emit a lone video or audio map: the other type is
    added as an optional ('?') map so nothing is dropped if the probe missed
    it. With nothing detected, return [] and let ffmpeg pick defaults.
    """
    if video_idx is None and audio_idx is None:
        return []
    args = []
    if video_idx is not None:
        args += ['-map', f'0:{video_idx}']
    else:
        args += ['-map', '0:v?']
    if audio_idx is not None:
        args += ['-map', f'0:{audio_idx}']
    else:
        args += ['-map', '0:a?']
    return args


def hls_map_args(content_url: str, resolution_index: int, probe=probe_hls):
    """
    Probe content_url and return (map_args, warning). warning is None when
    streams were selected normally, otherwise a human-readable explanation of
    the fallback that was used.
    """
    try:
        data = probe(content_url)
    except (RuntimeError, OSError) as e:
        return [], (f'Could not inspect HLS streams ({e}); '
                    'letting ffmpeg choose streams.')

    video_idx, audio_idx = select_streams(data, resolution_index)
    args = build_map_args(video_idx, audio_idx)

    if not args:
        return [], 'No streams detected; letting ffmpeg choose streams.'
    if video_idx is None and _has_unknown_streams(data):
        return [], ('Stream detection incomplete; '
                    'letting ffmpeg choose streams.')
    return args, None


def _has_unknown_streams(probe: dict) -> bool:
    streams, _ = _collect(probe)
    return any(s.get('codec_type') not in ('video', 'audio', 'subtitle',
                                           'data', 'attachment')
               for s in streams.values())
