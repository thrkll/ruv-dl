"""Tests for ruv-dl.py command construction and -r handling (no network)."""
import importlib.util
import io
import os
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'ruv-dl')
sys.path.insert(0, SRC)


def load_ruv_dl():
    # arguments.py parses sys.argv at import time
    with mock.patch.object(sys, 'argv', ['ruv-dl.py', '-i', 'https://ruv.is/x/1/2']):
        spec = importlib.util.spec_from_file_location(
            'ruv_dl', os.path.join(SRC, 'ruv-dl.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


ruv_dl = load_ruv_dl()


def attrs(url, resolution=0):
    return {'content_url': url, 'resolution': resolution, 'title': 'Show',
            'file_format': '.mp4', 'filepath': './'}


class TestResolutionSetting(unittest.TestCase):
    def run_with(self, value):
        with mock.patch.object(ruv_dl.args, 'resolution', value):
            return ruv_dl.resolution_setting()

    def test_default_is_best(self):
        self.assertEqual(self.run_with(None), 0)

    def test_levels(self):
        self.assertEqual(self.run_with('1'), 0)
        self.assertEqual(self.run_with('2'), 1)
        self.assertEqual(self.run_with('3'), 2)

    def test_invalid_values_exit(self):
        for bad in ('0', '4', 'high'):
            with redirect_stdout(io.StringIO()), self.assertRaises(SystemExit):
                self.run_with(bad)


class TestMissingSubtitles(unittest.TestCase):
    def run_subtitles(self, subs_only):
        a = attrs('https://ruv.is/x/index.m3u8')
        a['subtitle_url'] = None
        out = io.StringIO()
        with mock.patch.object(ruv_dl.args, 'subs_only', subs_only), \
                redirect_stdout(out):
            ruv_dl.subtitles(a)
        return out.getvalue()

    def test_missing_subtitles_do_not_exit(self):
        self.assertIn('No subtitles available', self.run_subtitles(False))
        self.assertIn('No subtitles available', self.run_subtitles(True))

    def run_single(self, subs_only):
        a = attrs('https://ruv.is/x/index.m3u8')
        a['subtitle_url'] = None
        m = ruv_dl
        with mock.patch.object(m.args, 'subtitles', True), \
                mock.patch.object(m.args, 'subs_only', subs_only), \
                mock.patch.object(m.args, 'fancy', False), \
                mock.patch.object(m, 'ruv_attributes', return_value=a), \
                mock.patch.object(m, 'filepath_setting', return_value='./'), \
                mock.patch.object(m, 'media_duration', return_value=60.0), \
                mock.patch.object(m, 'download') as download, \
                redirect_stdout(io.StringIO()):
            m.download_single()
        return download

    def test_single_without_subtitles_still_downloads(self):
        self.run_single(subs_only=False).assert_called_once()

    def test_single_subs_only_skips_download(self):
        self.run_single(subs_only=True).assert_not_called()


def rest_response(program_id, episode_id, title, multiple=True):
    """Fake api.ruv.is response for one episode."""
    r = mock.Mock()
    r.raise_for_status.return_value = None
    r.json.return_value = {
        'title': 'Sýning', 'multiple_episodes': multiple,
        'image': None, 'portrait_image': None, 'description': ['Lýsing'],
        'episodes': [{'id': episode_id, 'title': title,
                      'file': f'https://cdn/{episode_id}/index.m3u8',
                      'subtitles_url': None}]}
    return r


class TestDownloadSeries(unittest.TestCase):
    URL = 'https://www.ruv.is/sjonvarp/spila/syning/37230/e2'
    EPISODES = [{'id': 'e1', 'number': '1', 'title': 'Þáttur 1 af 3'},
                {'id': 'e2', 'number': '2', 'title': 'Þáttur 2 af 3'},
                {'id': 'e3', 'number': '3', 'title': 'Þáttur 3 af 3'}]

    def setUp(self):
        import tempfile
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(__import__('shutil').rmtree, self.tmp, ignore_errors=True)
        cwd = os.getcwd()
        os.chdir(self.tmp)
        self.addCleanup(os.chdir, cwd)
        self.rest_calls = []

    def fake_get(self, url, timeout=None):
        self.rest_calls.append(url)
        pid, eid = url.rstrip('/').split('/')[-2:]
        title = next(e['title'] for e in self.EPISODES if e['id'] == eid)
        return rest_response(pid, eid, title)

    def run_series(self, selection, fancy=False, output=None, subs_only=False,
                   titles=None, stdin='y', yes=False, no=False):
        m = ruv_dl
        episodes = [dict(e) for e in self.EPISODES]
        if titles:
            for e, t in zip(episodes, titles):
                e['title'] = t
            self.EPISODES = episodes
        out = io.StringIO()
        with mock.patch.multiple(m.args, input=self.URL, episodes=selection,
                                 fancy=fancy, output=output, resolution='2',
                                 format=None, subtitles=False,
                                 subs_only=subs_only, yes=yes, no=no), \
                mock.patch.object(m, 'fetch_episodes', return_value=episodes), \
                mock.patch.object(m.requests, 'get', side_effect=self.fake_get), \
                mock.patch.object(m, 'media_duration', return_value=60.0), \
                mock.patch.object(m, 'fancy_folder') as fancy_folder, \
                mock.patch.object(m, 'subtitles') as subtitles, \
                mock.patch('builtins.input', return_value=stdin) as prompt, \
                mock.patch.object(m, 'download') as download, \
                redirect_stdout(out):
            m.download_series()
        self.output = out.getvalue()
        self.prompt = prompt
        return download, fancy_folder, subtitles

    def downloaded(self, download):
        return [c.args[0] for c in download.call_args_list]

    def test_all_episodes_in_order(self):
        download, _, _ = self.run_series('all')
        got = self.downloaded(download)
        self.assertEqual([a['title'] for a in got],
                         ['Sýning - Þáttur 1 af 3', 'Sýning - Þáttur 2 af 3',
                          'Sýning - Þáttur 3 af 3'])
        self.assertEqual(self.rest_calls, [
            'https://api.ruv.is/api/programs/program/37230/e1',
            'https://api.ruv.is/api/programs/program/37230/e2',
            'https://api.ruv.is/api/programs/program/37230/e3'])
        self.assertTrue(all(a['resolution'] == 1 for a in got))
        self.assertTrue(all(a['filepath'] == './' for a in got))
        self.assertIn('Found 3 episodes', self.output)

    def test_selection_and_missing(self):
        download, _, _ = self.run_series('2-4')
        self.assertEqual([a['content_url'] for a in self.downloaded(download)],
                         ['https://cdn/e2/index.m3u8', 'https://cdn/e3/index.m3u8'])
        self.assertIn('Not available: episode 4', self.output)

    def test_no_match_exits(self):
        with self.assertRaises(SystemExit):
            self.run_series('9')

    def test_invalid_selection_exits_before_network(self):
        with self.assertRaises(SystemExit):
            self.run_series('abc')
        self.assertEqual(self.rest_calls, [])

    def test_fancy_uses_one_show_folder_and_keeps_existing(self):
        os.makedirs('Sýning')
        with open(os.path.join('Sýning', 'keep.txt'), 'w') as f:
            f.write('x')
        download, fancy_folder, _ = self.run_series('all', fancy=True)
        self.assertTrue(os.path.isfile(os.path.join('Sýning', 'keep.txt')))
        self.assertEqual({a['filepath'] for a in self.downloaded(download)},
                         {'./Sýning/'})
        fancy_folder.assert_called_once()

    def test_output_name_is_prefix(self):
        download, _, _ = self.run_series('1-2', fancy=True, output='Mitt')
        self.assertEqual([a['title'] for a in self.downloaded(download)],
                         ['Mitt - Þáttur 1 af 3', 'Mitt - Þáttur 2 af 3'])
        self.assertTrue(os.path.isdir('Mitt'))

    def test_duplicate_titles_made_unique(self):
        download, _, _ = self.run_series(
            'all', titles=['Fréttir', 'Fréttir', 'Fréttir'])
        self.assertEqual([a['title'] for a in self.downloaded(download)],
                         ['Sýning - Fréttir', 'Sýning - Fréttir (2)',
                          'Sýning - Fréttir (3)'])

    def test_existing_file_declined_is_skipped(self):
        open('Sýning - Þáttur 1 af 3.mp4', 'w').close()
        download, _, _ = self.run_series('all', stdin='n')
        self.assertEqual([a['title'] for a in self.downloaded(download)],
                         ['Sýning - Þáttur 2 af 3', 'Sýning - Þáttur 3 af 3'])

    def test_no_flag_skips_existing_without_asking(self):
        open('Sýning - Þáttur 1 af 3.mp4', 'w').close()
        open('Sýning - Þáttur 3 af 3.mp4', 'w').close()
        download, _, _ = self.run_series('all', no=True)
        self.prompt.assert_not_called()
        self.assertEqual([a['title'] for a in self.downloaded(download)],
                         ['Sýning - Þáttur 2 af 3'])
        self.assertIn('Skipping Sýning - Þáttur 1 af 3 (already exists)',
                      self.output)

    def test_yes_flag_overwrites_without_asking(self):
        open('Sýning - Þáttur 1 af 3.mp4', 'w').close()
        download, _, _ = self.run_series('all', yes=True, stdin='n')
        self.prompt.assert_not_called()
        self.assertEqual(download.call_count, 3)
        self.assertIn('Overwriting (--yes)', self.output)

    def test_subs_only_downloads_no_media(self):
        download, _, subtitles = self.run_series('all', subs_only=True)
        download.assert_not_called()
        self.assertEqual(subtitles.call_count, 3)


class TestAnswerFlags(unittest.TestCase):
    def test_yes_and_no_are_exclusive(self):
        parser = sys.modules['arguments'].parser
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            parser.parse_args(['-i', 'x', '-y', '-n'])
        self.assertTrue(parser.parse_args(['-i', 'x', '--no']).no)
        self.assertTrue(parser.parse_args(['-i', 'x', '-y']).yes)

    def test_single_download_with_no_flag_exits_without_asking(self):
        import tempfile
        tmp = tempfile.mkdtemp()
        cwd = os.getcwd()
        os.chdir(tmp)
        try:
            open('Show.mp4', 'w').close()
            out = io.StringIO()
            with mock.patch.multiple(ruv_dl.args, fancy=False, no=True, yes=False), \
                    mock.patch('builtins.input') as prompt, \
                    redirect_stdout(out), self.assertRaises(SystemExit):
                ruv_dl.filepath_setting(attrs('u.m3u8'))
            prompt.assert_not_called()
            self.assertIn('Nothing downloaded', out.getvalue())
        finally:
            os.chdir(cwd)
            __import__('shutil').rmtree(tmp, ignore_errors=True)


class TestBuildDownloadCmd(unittest.TestCase):
    def test_hls_with_query_string_uses_stream_selection(self):
        url = 'https://ruv.is/x/index.m3u8?token=abc'
        calls = []

        def fake(content_url, res):
            calls.append((content_url, res))
            return ['-map', '0:2', '-map', '0:0'], None

        cmd = ruv_dl.build_download_cmd(attrs(url, 2), map_args_fn=fake)
        self.assertEqual(calls, [(url, 2)])
        self.assertEqual(cmd[:7], ['ffmpeg', '-y', '-loglevel', 'error',
                                   '-stats', '-i', url])
        self.assertEqual(cmd[7:11], ['-map', '0:2', '-map', '0:0'])
        self.assertEqual(cmd[-1], './Show.mp4')
        self.assertIn('-async', cmd)

    def test_hls_fallback_prints_warning_and_omits_maps(self):
        out = io.StringIO()
        with redirect_stdout(out):
            cmd = ruv_dl.build_download_cmd(
                attrs('https://ruv.is/x/index.m3u8'),
                map_args_fn=lambda u, r: ([], 'probe failed'))
        self.assertNotIn('-map', cmd)
        self.assertIn('probe failed', out.getvalue())

    def test_non_hls_unchanged(self):
        def never(*_):
            raise AssertionError('should not probe non-HLS content')
        url = 'https://ruv.is/radio/file.mp3?x=1.m3u8'
        cmd = ruv_dl.build_download_cmd(attrs(url), map_args_fn=never)
        self.assertEqual(cmd, ['ffmpeg', '-y', '-loglevel', 'error', '-stats',
                               '-i', url, '-c', 'copy', './Show.mp4'])


if __name__ == '__main__':
    unittest.main()
