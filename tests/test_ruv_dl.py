"""Tests for ruv-dl.py command construction and -r handling (no network)."""
import importlib.util
import io
import os
import sys
import unittest
from contextlib import redirect_stdout
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

    def test_missing_subtitles_continue_to_download(self):
        self.assertIn('No subtitles available', self.run_subtitles(False))

    def test_missing_subtitles_with_subs_only_exits(self):
        with self.assertRaises(SystemExit):
            self.run_subtitles(True)


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
