"""
Helpers for downloading several episodes of a series.

The REST API (api.ruv.is) only returns the single episode asked for, so the
list of available episodes comes from the GraphQL API used by the RÚV player.
Each episode is then fetched through the REST API as usual.
"""

import re
import requests

GRAPHQL_URL = 'https://spilari.nyr.ruv.is/gql/'

_EPISODES_QUERY = '''
query getProgram($id: Int!) {
  Program(id: $id) {
    title
    episodes {
      id
      number
      title
    }
  }
}
'''


def parse_ruv_url(url: str):
    """
    Returns (program_id, episode_id) from a ruv.is player URL. episode_id is
    None when the URL points at the programme itself.

        .../spila/content-name/XXXXX?ep=ZZZZZZ
        .../spila/content-name/XXXXX/ZZZZZZ
        .../spila/content-name/XXXXX
    """
    path = url.replace('?ep=', '/').split('?')[0].split('#')[0].rstrip('/')
    parts = path.split('/')
    if parts and parts[-1].isdigit():
        return parts[-1], None
    if len(parts) >= 2 and parts[-2].isdigit():
        return parts[-2], parts[-1]
    return None, None


def fetch_episodes(program_id) -> list:
    """
    Returns the available episodes as dicts with 'id', 'number' and 'title',
    sorted by episode number (oldest first). Raises RuntimeError on failure.
    """
    payload = {
        'operationName': 'getProgram',
        'variables': {'id': int(program_id)},
        'query': _EPISODES_QUERY,
    }
    try:
        r = requests.post(GRAPHQL_URL, json=payload, timeout=10)
        r.raise_for_status()
        program = (r.json().get('data') or {}).get('Program')
    except (requests.exceptions.RequestException, ValueError) as e:
        raise RuntimeError(f'could not fetch episode list ({e})')

    if not program:
        raise RuntimeError('program not found')

    episodes = [e for e in program.get('episodes') or [] if e and e.get('id')]
    # Numbered episodes in ascending order; unnumbered keep API order at the end
    return sorted(episodes, key=lambda e: (_number(e) is None, _number(e) or 0))


def _number(episode):
    try:
        return int(str(episode.get('number')).strip())
    except (TypeError, ValueError):
        return None


def parse_selection(text: str):
    """
    Parses an episode selection such as 'all', '3', '1-3' or '1-3,5,8-'.
    Returns None for 'all', otherwise a list of (start, end) ranges where end
    may be None for an open range. Raises ValueError on invalid input.
    """
    text = (text or '').strip().lower()
    if text in ('all', 'a', '*'):
        return None
    ranges = []
    for part in text.split(','):
        part = part.strip()
        m = re.fullmatch(r'(\d+)(?:\s*-\s*(\d*))?', part)
        if not m:
            raise ValueError(f'invalid episode selection: {part!r}')
        start = int(m.group(1))
        if m.group(2) is None:
            end = start                       # '3'
        elif m.group(2) == '':
            end = None                        # '3-'
        else:
            end = int(m.group(2))             # '1-3'
            if end < start:
                raise ValueError(f'invalid episode range: {part!r}')
        ranges.append((start, end))
    return ranges


def select_episodes(episodes: list, selection: str):
    """
    Filters episodes by a selection string (see parse_selection).
    Returns (selected_episodes, missing_numbers) where missing_numbers lists
    explicitly requested episode numbers that are not available.
    """
    ranges = parse_selection(selection)
    if ranges is None:
        return list(episodes), []

    def wanted(n):
        return n is not None and any(
            n >= start and (end is None or n <= end) for start, end in ranges)

    selected = [e for e in episodes if wanted(_number(e))]
    available = {_number(e) for e in episodes}
    missing = sorted({n for start, end in ranges if end is not None
                      for n in range(start, end + 1)} - available)
    return selected, missing
