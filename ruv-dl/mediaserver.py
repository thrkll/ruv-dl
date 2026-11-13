"""
Media server naming, .nfo files and embedded file metadata.

Layout produced with -m (understood by Jellyfin, Emby, Kodi and Plex):

    Show/
        tvshow.nfo  poster.jpg  fanart.jpg
        Season 02/
            poster.jpg
            Show - S02E05 - Episode title.mp4
            Show - S02E05 - Episode title.nfo
            Show - S02E05 - Episode title-thumb.jpg
            Show - S02E05 - Episode title.is.srt

    Film/                       (programs without episodes)
        Film.mp4  Film.nfo  poster.jpg  fanart.jpg

RÚV has no season field. Each season is its own program with a Roman numeral
at the end of the title ("Blæja II"), so that numeral is read as the season.
"""

import re
import xml.etree.ElementTree as ET

NETWORK = 'RÚV'

_ROMAN_VALUES = [(10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]


def _int_to_roman(n: int) -> str:
    out = ''
    for value, numeral in _ROMAN_VALUES:
        while n >= value:
            out += numeral
            n -= value
    return out


def _roman_to_int(text: str):
    # Accepts canonical numerals from I to XXXIX
    for n in range(1, 40):
        if _int_to_roman(n) == text:
            return n
    return None


def split_season(title: str):
    """'Blæja II' -> ('Blæja', 2); 'Blæja' -> ('Blæja', 1)."""
    title = (title or '').strip()
    m = re.match(r'^(.*?\S)[\s:–-]+([IVX]+)$', title)
    if m:
        season = _roman_to_int(m.group(2))
        if season:
            return m.group(1).rstrip(' :–-'), season
    return title, 1


def sanitize(name: str) -> str:
    """Keeps characters that are safe in file and folder names."""
    return re.sub(r'\s+', ' ', re.sub(r'[^\w_.)( -]', '', name or '')).strip()


def _is_generic_title(title: str) -> bool:
    # 'Þáttur 5 af 8' adds nothing once the name has S01E05 in it
    return bool(re.fullmatch(r'(Þáttur|Thattur)\s+\d+(\s+af\s+\d+)?',
                             (title or '').strip(), re.IGNORECASE))


def _to_int(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _date(value):
    """'2026-04-04T10:00:00' -> '2026-04-04'."""
    m = re.match(r'\d{4}-\d{2}-\d{2}', str(value or ''))
    return m.group(0) if m else None


def layout(meta: dict, output=None) -> dict:
    """
    Works out names for a program/episode from RÚV metadata.

    meta keys: program_title, multiple_episodes, episode_title, number,
    firstrun. output (the -o flag) replaces the show name.
    """
    aired = _date(meta.get('firstrun'))

    if not meta.get('multiple_episodes'):
        name = sanitize(output or meta.get('program_title'))
        return {'kind': 'movie', 'show': name, 'season': None, 'episode': None,
                'episode_title': None, 'aired': aired,
                'show_folder': f'./{name}/', 'folder': f'./{name}/',
                'basename': name}

    show, season = split_season(meta.get('program_title'))
    show = sanitize(output or show)
    number = _to_int(meta.get('number'))
    episode_title = (meta.get('episode_title') or '').strip()

    parts = [show]
    if number is not None:
        parts.append(f'S{season:02d}E{number:02d}')
    elif aired:
        parts.append(aired)
    if episode_title and not _is_generic_title(episode_title):
        parts.append(episode_title)

    return {'kind': 'episode', 'show': show, 'season': season,
            'episode': number, 'episode_title': episode_title or None,
            'aired': aired,
            'show_folder': f'./{show}/',
            'folder': f'./{show}/Season {season:02d}/',
            'basename': sanitize(' - '.join(parts))}


def _nfo(root_tag: str, fields: list) -> str:
    root = ET.Element(root_tag)
    for key, value in fields:
        if value not in (None, ''):
            ET.SubElement(root, key).text = str(value)
    if hasattr(ET, 'indent'):  # Python 3.9+
        ET.indent(root)
    body = ET.tostring(root, encoding='unicode')
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body + '\n'


def tvshow_nfo(meta: dict, info: dict) -> str:
    original, _ = split_season(meta.get('foreign_title') or '')
    return _nfo('tvshow', [
        ('title', info['show']),
        ('originaltitle', original),
        ('plot', meta.get('program_description')),
        *[('genre', g) for g in meta.get('genres') or []],
        ('studio', NETWORK),
    ])


def episode_nfo(meta: dict, info: dict) -> str:
    if info['kind'] == 'movie':
        return _nfo('movie', [
            ('title', meta.get('program_title')),
            ('originaltitle', meta.get('foreign_title')),
            ('plot', meta.get('episode_description')
                     or meta.get('program_description')),
            *[('genre', g) for g in meta.get('genres') or []],
            ('mpaa', meta.get('rating')),
            ('studio', NETWORK),
        ])
    return _nfo('episodedetails', [
        ('title', info['episode_title'] or info['basename']),
        ('showtitle', info['show']),
        ('season', info['season']),
        ('episode', info['episode']),
        ('plot', meta.get('episode_description')),
        ('aired', info['aired']),
        ('mpaa', meta.get('rating')),
        ('studio', NETWORK),
    ])


def metadata_args(meta: dict, info: dict, file_format: str) -> list:
    """ffmpeg -metadata arguments describing the program/episode."""
    plot = meta.get('episode_description') or meta.get('program_description')
    genres = meta.get('genres') or []
    if info['kind'] == 'episode':
        tags = [
            ('title', info['episode_title'] or info['show']),
            ('show', info['show']),
            ('season_number', info['season']),
            ('episode_sort', info['episode']),
            ('episode_id', f'S{info["season"]:02d}E{info["episode"]:02d}'
                           if info['episode'] is not None else None),
        ]
    else:
        tags = [('title', meta.get('program_title'))]
    tags += [
        ('description', plot),
        ('synopsis', plot),
        ('date', info['aired']),
        ('genre', genres[0] if genres else None),
        ('network', NETWORK),
    ]
    if file_format.lower() in ('.mp4', '.m4v', '.mov'):
        # iTunes media kind: 10 = TV show, 9 = movie
        tags.append(('media_type', 10 if info['kind'] == 'episode' else 9))

    args = []
    for key, value in tags:
        if value not in (None, ''):
            args += ['-metadata', f'{key}={value}']
    return args
