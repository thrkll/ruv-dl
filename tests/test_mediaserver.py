"""Tests for media server naming, .nfo files and embedded metadata."""
import os
import sys
import unittest
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'ruv-dl'))

import mediaserver as ms  # noqa: E402


def meta(**overrides):
    m = {
        'program_title': 'Blæja II',
        'foreign_title': 'Bluey II',
        'multiple_episodes': True,
        'episode_title': 'Mömmuskóli',
        'number': '5',
        'firstrun': '2024-10-14T08:00:00',
        'rating': 'L',
        'program_description': 'Blæja er sex ára hundur.',
        'episode_description': 'Blæja leikur mömmu.',
        'genres': ['Barnaefni', 'Teiknimyndir'],
        'episode_image': 'https://img/ep.jpg',
    }
    m.update(overrides)
    return m


class TestSplitSeason(unittest.TestCase):
    def test_roman_numerals(self):
        cases = {
            'Blæja II': ('Blæja', 2),
            'Blæja I': ('Blæja', 1),
            'Dalgliesh III': ('Dalgliesh', 3),
            'Að baki hvers manns II': ('Að baki hvers manns', 2),
            'Show IV': ('Show', 4),
            'Show IX': ('Show', 9),
            'Show XII': ('Show', 12),
            'Show - II': ('Show', 2),
        }
        for title, expected in cases.items():
            self.assertEqual(ms.split_season(title), expected, title)

    def test_no_season(self):
        for title in ('Blæja', '20 og eitthvað', '2026', 'Krakkafréttir',
                      'Show IIII', 'Show VX', 'Show ii', 'II', 'Dr. Who VI2'):
            self.assertEqual(ms.split_season(title), (title, 1), title)


class TestLayout(unittest.TestCase):
    def test_episode(self):
        info = ms.layout(meta())
        self.assertEqual(info['basename'], 'Blæja - S02E05 - Mömmuskóli')
        self.assertEqual(info['folder'], './Blæja/Season 02/')
        self.assertEqual(info['show_folder'], './Blæja/')
        self.assertEqual((info['show'], info['season'], info['episode']),
                         ('Blæja', 2, 5))
        self.assertEqual(info['aired'], '2024-10-14')

    def test_generic_episode_title_dropped(self):
        info = ms.layout(meta(program_title='Að baki hvers manns II',
                              episode_title='Þáttur 5 af 8'))
        self.assertEqual(info['basename'], 'Að baki hvers manns - S02E05')

    def test_season_one_without_numeral(self):
        info = ms.layout(meta(program_title='20 og eitthvað',
                              episode_title='Þáttur 1 af 6', number=1))
        self.assertEqual(info['folder'], './20 og eitthvað/Season 01/')
        self.assertEqual(info['basename'], '20 og eitthvað - S01E01')

    def test_unnumbered_episode_uses_air_date(self):
        info = ms.layout(meta(number=None, episode_title='Fréttir'))
        self.assertEqual(info['basename'], 'Blæja - 2024-10-14 - Fréttir')
        self.assertIsNone(info['episode'])

    def test_output_replaces_show_name(self):
        info = ms.layout(meta(), output='Bluey')
        self.assertEqual(info['basename'], 'Bluey - S02E05 - Mömmuskóli')
        self.assertEqual(info['folder'], './Bluey/Season 02/')

    def test_movie_keeps_numeral(self):
        info = ms.layout(meta(program_title='Rocky II', multiple_episodes=False,
                              episode_title=None))
        self.assertEqual(info['kind'], 'movie')
        self.assertEqual(info['basename'], 'Rocky II')
        self.assertEqual(info['folder'], './Rocky II/')

    def test_unsafe_characters_removed(self):
        info = ms.layout(meta(program_title='Hvað/er: þetta? II',
                              episode_title='A "quote" *'))
        self.assertEqual(info['basename'], 'Hvaðer þetta - S02E05 - A quote')


class TestNfo(unittest.TestCase):
    def parse(self, text):
        self.assertTrue(text.startswith('<?xml version="1.0" encoding="UTF-8"'))
        return ET.fromstring(text.split('\n', 1)[1])

    def test_episode_nfo(self):
        root = self.parse(ms.episode_nfo(meta(), ms.layout(meta())))
        self.assertEqual(root.tag, 'episodedetails')
        self.assertEqual(root.findtext('title'), 'Mömmuskóli')
        self.assertEqual(root.findtext('showtitle'), 'Blæja')
        self.assertEqual(root.findtext('season'), '2')
        self.assertEqual(root.findtext('episode'), '5')
        self.assertEqual(root.findtext('aired'), '2024-10-14')
        self.assertEqual(root.findtext('plot'), 'Blæja leikur mömmu.')
        self.assertEqual(root.findtext('mpaa'), 'L')

    def test_tvshow_nfo(self):
        root = self.parse(ms.tvshow_nfo(meta(), ms.layout(meta())))
        self.assertEqual(root.tag, 'tvshow')
        self.assertEqual(root.findtext('title'), 'Blæja')
        self.assertEqual(root.findtext('originaltitle'), 'Bluey')
        self.assertEqual([g.text for g in root.findall('genre')],
                         ['Barnaefni', 'Teiknimyndir'])
        self.assertEqual(root.findtext('studio'), 'RÚV')

    def test_movie_nfo(self):
        m = meta(program_title='Kvikmynd', multiple_episodes=False,
                 episode_title=None, episode_description='')
        root = self.parse(ms.episode_nfo(m, ms.layout(m)))
        self.assertEqual(root.tag, 'movie')
        self.assertEqual(root.findtext('plot'), 'Blæja er sex ára hundur.')

    def test_special_characters_escaped(self):
        m = meta(episode_description='Tom & Jerry <3')
        root = self.parse(ms.episode_nfo(m, ms.layout(m)))
        self.assertEqual(root.findtext('plot'), 'Tom & Jerry <3')

    def test_empty_values_left_out(self):
        m = meta(rating='', foreign_title=None, genres=[])
        self.assertIsNone(self.parse(ms.episode_nfo(m, ms.layout(m))).find('mpaa'))
        show = self.parse(ms.tvshow_nfo(m, ms.layout(m)))
        self.assertIsNone(show.find('originaltitle'))
        self.assertEqual(show.findall('genre'), [])


class TestMetadataArgs(unittest.TestCase):
    def tags(self, m, fmt='.mp4'):
        args = ms.metadata_args(m, ms.layout(m), fmt)
        self.assertEqual(args[::2], ['-metadata'] * (len(args) // 2))
        return dict(a.split('=', 1) for a in args[1::2])

    def test_episode_tags(self):
        tags = self.tags(meta())
        self.assertEqual(tags['title'], 'Mömmuskóli')
        self.assertEqual(tags['show'], 'Blæja')
        self.assertEqual(tags['season_number'], '2')
        self.assertEqual(tags['episode_sort'], '5')
        self.assertEqual(tags['episode_id'], 'S02E05')
        self.assertEqual(tags['description'], 'Blæja leikur mömmu.')
        self.assertEqual(tags['date'], '2024-10-14')
        self.assertEqual(tags['genre'], 'Barnaefni')
        self.assertEqual(tags['network'], 'RÚV')
        self.assertEqual(tags['media_type'], '10')

    def test_movie_tags(self):
        m = meta(program_title='Kvikmynd', multiple_episodes=False,
                 episode_title=None)
        tags = self.tags(m)
        self.assertEqual(tags['title'], 'Kvikmynd')
        self.assertNotIn('show', tags)
        self.assertEqual(tags['media_type'], '9')

    def test_media_type_only_for_mp4_family(self):
        self.assertNotIn('media_type', self.tags(meta(), '.mkv'))
        self.assertNotIn('media_type', self.tags(meta(), '.mp3'))

    def test_missing_values_skipped(self):
        tags = self.tags(meta(number=None, episode_description='',
                              program_description='', genres=[]))
        for key in ('episode_sort', 'episode_id', 'description', 'genre'):
            self.assertNotIn(key, tags)


if __name__ == '__main__':
    unittest.main()
