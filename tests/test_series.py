"""Tests for series helpers. The GraphQL API is mocked; no network access."""
import os
import sys
import unittest
from unittest import mock

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'ruv-dl'))

import series  # noqa: E402


def ep(eid, number, title=None):
    return {'id': eid, 'number': number, 'title': title or f'Þáttur {number}'}


class TestParseRuvUrl(unittest.TestCase):
    def test_url_forms(self):
        cases = {
            'https://www.ruv.is/sjonvarp/spila/show/37230/b31m75': ('37230', 'b31m75'),
            'https://www.ruv.is/sjonvarp/spila/show/37230/b31m75/': ('37230', 'b31m75'),
            'https://www.ruv.is/sjonvarp/spila/show/37230?ep=b31m75': ('37230', 'b31m75'),
            'https://www.ruv.is/sjonvarp/spila/show/37230': ('37230', None),
            'https://www.ruv.is/utvarp/spila/show/12345/abc123?x=1#t': ('12345', 'abc123'),
            # A numeric slug must not be mistaken for the program ID
            'https://www.ruv.is/sjonvarp/spila/2026/39292/bmmuu1': ('39292', 'bmmuu1'),
            'https://www.ruv.is/sjonvarp/spila/2026/39292': ('39292', None),
        }
        for url, expected in cases.items():
            self.assertEqual(series.parse_ruv_url(url), expected, url)

    def test_invalid(self):
        self.assertEqual(series.parse_ruv_url('https://www.ruv.is/frettir'),
                         (None, None))


class TestSelection(unittest.TestCase):
    episodes = [ep('a1', '1'), ep('a2', '2'), ep('a3', '3'), ep('a5', '5'),
                ep('ax', None, 'Aukaþáttur')]

    def ids(self, text):
        return [e['id'] for e in series.select_episodes(self.episodes, text)[0]]

    def test_all(self):
        self.assertEqual(self.ids('all'), ['a1', 'a2', 'a3', 'a5', 'ax'])
        self.assertEqual(self.ids(' ALL '), ['a1', 'a2', 'a3', 'a5', 'ax'])

    def test_single_and_ranges(self):
        self.assertEqual(self.ids('2'), ['a2'])
        self.assertEqual(self.ids('1-3'), ['a1', 'a2', 'a3'])
        self.assertEqual(self.ids('1, 5'), ['a1', 'a5'])
        self.assertEqual(self.ids('3-'), ['a3', 'a5'])

    def test_overlapping_ranges_do_not_duplicate(self):
        self.assertEqual(self.ids('1-3,2-3'), ['a1', 'a2', 'a3'])

    def test_missing_numbers_reported(self):
        selected, missing = series.select_episodes(self.episodes, '3-6,9')
        self.assertEqual([e['id'] for e in selected], ['a3', 'a5'])
        self.assertEqual(missing, [4, 6, 9])

    def test_invalid_selection(self):
        for bad in ('', 'x', '3-1', '1--2', '1,,2', '-3'):
            with self.assertRaises(ValueError, msg=bad):
                series.parse_selection(bad)


class TestFetchEpisodes(unittest.TestCase):
    def response(self, payload, status=200):
        r = mock.Mock()
        r.json.return_value = payload
        r.raise_for_status.side_effect = (
            requests.exceptions.HTTPError('400') if status >= 400 else None)
        return r

    def test_sorted_oldest_first(self):
        # The API lists newest first
        payload = {'data': {'Program': {'title': 'Show', 'episodes': [
            ep('b3', '3'), ep('b2', '2'), ep('b10', '10'), ep('b1', '1'),
            ep('bx', '', 'Extra')]}}}
        with mock.patch.object(series.requests, 'post',
                               return_value=self.response(payload)) as post:
            episodes = series.fetch_episodes('37230')
        self.assertEqual([e['id'] for e in episodes],
                         ['b1', 'b2', 'b3', 'b10', 'bx'])
        sent = post.call_args.kwargs['json']
        self.assertEqual(sent['variables'], {'id': 37230})
        self.assertEqual(post.call_args.args[0], series.GRAPHQL_URL)

    def test_program_not_found(self):
        with mock.patch.object(series.requests, 'post', return_value=self.response(
                {'data': {'Program': None}})):
            with self.assertRaises(RuntimeError):
                series.fetch_episodes('1')

    def test_http_error(self):
        with mock.patch.object(series.requests, 'post', return_value=self.response(
                {'errors': []}, status=400)):
            with self.assertRaises(RuntimeError):
                series.fetch_episodes('1')

    def test_connection_error(self):
        with mock.patch.object(series.requests, 'post',
                               side_effect=requests.exceptions.ConnectionError()):
            with self.assertRaises(RuntimeError):
                series.fetch_episodes('1')


if __name__ == '__main__':
    unittest.main()
