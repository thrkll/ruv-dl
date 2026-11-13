"""
Unit tests for HLS stream selection. No network access; ffprobe is mocked.

Fixtures in tests/fixtures/ffprobe_*.json are real `ffprobe -show_programs
-show_streams -of json` output captured from small locally generated HLS
streams (see tests/test_integration.py for how they are produced).
"""
import copy
import json
import os
import random
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'ruv-dl'))

import hls  # noqa: E402


def fixture(name):
    with open(os.path.join(HERE, 'fixtures', name), encoding='utf-8') as f:
        return json.load(f)


def v(index, w, h, bitrate=None):
    s = {'index': index, 'codec_type': 'video', 'width': w, 'height': h}
    if bitrate is not None:
        s['tags'] = {'variant_bitrate': str(bitrate)}
    return s


def a(index, lang=None, default=0, **disp):
    s = {'index': index, 'codec_type': 'audio',
         'disposition': dict(default=default, **disp)}
    if lang:
        s['tags'] = {'language': lang}
    return s


def program(pid, *streams, bitrate=None):
    p = {'program_id': pid, 'streams': list(streams)}
    if bitrate is not None:
        p['tags'] = {'variant_bitrate': str(bitrate)}
    return p


def probe_from_programs(*programs):
    """Builds ffprobe-like output: streams per program and again top-level."""
    top = {}
    for p in programs:
        for s in p['streams']:
            top.setdefault(s['index'], s)
    return {'programs': list(programs),
            'streams': [top[i] for i in sorted(top)]}


class TestIsHlsUrl(unittest.TestCase):
    def test_plain(self):
        self.assertTrue(hls.is_hls_url('https://x.ruv.is/a/b/index.m3u8'))

    def test_query_string(self):
        self.assertTrue(hls.is_hls_url(
            'https://x.ruv.is/a/index.m3u8?token=abc&expires=123'))

    def test_fragment_and_case(self):
        self.assertTrue(hls.is_hls_url('https://x.ruv.is/a/INDEX.M3U8#t=1'))

    def test_not_hls(self):
        self.assertFalse(hls.is_hls_url('https://x.ruv.is/a/file.mp4'))
        self.assertFalse(hls.is_hls_url('https://x.ruv.is/a/file.mp3'))
        # .m3u8 only in the query must not count
        self.assertFalse(hls.is_hls_url('https://x.ruv.is/f.mp4?src=a.m3u8'))
        self.assertFalse(hls.is_hls_url(''))
        self.assertFalse(hls.is_hls_url(None))


class TestSelectFromRealFixtures(unittest.TestCase):
    def test_audio_group_resolution_levels(self):
        # 640x360 = stream 2, 320x180 = 3, 160x90 = 4; audio group: 0 isl, 1 eng
        probe = fixture('ffprobe_hls_audio_group.json')
        self.assertEqual(hls.select_streams(probe, 0), (2, 0))
        self.assertEqual(hls.select_streams(probe, 1), (3, 0))
        self.assertEqual(hls.select_streams(probe, 2), (4, 0))

    def test_muxed_audio_follows_selected_variant(self):
        # Variants listed 320, 640, 160; each has its own muxed audio.
        # The old audios[0] strategy paired 640p video with 320p's audio.
        probe = fixture('ffprobe_hls_muxed_shuffled.json')
        self.assertEqual(hls.select_streams(probe, 0), (2, 3))
        self.assertEqual(hls.select_streams(probe, 1), (0, 1))
        self.assertEqual(hls.select_streams(probe, 2), (4, 5))

    def test_audio_only(self):
        probe = fixture('ffprobe_hls_audio_only.json')
        for r in (0, 1, 2):
            self.assertEqual(hls.select_streams(probe, r), (None, 0))
        args, warning = hls.hls_map_args('u.m3u8', 0, probe=lambda u: probe)
        self.assertEqual(args, ['-map', '0:v?', '-map', '0:0'])
        self.assertIsNone(warning)

    def test_fixture_has_duplicate_entries(self):
        # Guard: the fixture really does list streams more than once
        probe = fixture('ffprobe_hls_audio_group.json')
        indices = [s['index'] for s in probe['streams']]
        indices += [s['index'] for p in probe['programs'] for s in p['streams']]
        self.assertGreater(len(indices), len(set(indices)))


class TestResolutionSelection(unittest.TestCase):
    def three_variants(self):
        return probe_from_programs(
            program(0, v(0, 1920, 1080), a(1, 'isl')),
            program(1, v(2, 1280, 720), a(3, 'isl')),
            program(2, v(4, 852, 480), a(5, 'isl')),
        )

    def test_levels(self):
        probe = self.three_variants()
        self.assertEqual(hls.select_streams(probe, 0), (0, 1))
        self.assertEqual(hls.select_streams(probe, 1), (2, 3))
        self.assertEqual(hls.select_streams(probe, 2), (4, 5))

    def test_clamping(self):
        probe = self.three_variants()
        self.assertEqual(hls.select_streams(probe, 7), (4, 5))
        self.assertEqual(hls.select_streams(probe, -1), (0, 1))

    def test_shuffled_order_is_irrelevant(self):
        base = self.three_variants()
        rng = random.Random(1234)
        for _ in range(25):
            probe = copy.deepcopy(base)
            rng.shuffle(probe['programs'])
            rng.shuffle(probe['streams'])
            for p in probe['programs']:
                rng.shuffle(p['streams'])
            self.assertEqual(hls.select_streams(probe, 0), (0, 1))
            self.assertEqual(hls.select_streams(probe, 1), (2, 3))
            self.assertEqual(hls.select_streams(probe, 2), (4, 5))

    def test_duplicate_entries_do_not_count_as_variants(self):
        hi = v(0, 1920, 1080)
        lo = v(2, 1280, 720)
        probe = probe_from_programs(
            program(0, hi, a(1, 'isl')),
            program(1, lo, a(3, 'isl')),
        )
        # Repeat every stream entry a few more times
        probe['streams'] = probe['streams'] * 3
        probe['programs'].append(copy.deepcopy(probe['programs'][0]))
        self.assertEqual(hls.select_streams(probe, 0), (0, 1))
        self.assertEqual(hls.select_streams(probe, 1), (2, 3))
        # Only two distinct variants: -r 3 clamps to the lowest
        self.assertEqual(hls.select_streams(probe, 2), (2, 3))

    def test_identical_renditions_collapse(self):
        # Two different stream indices carrying an identical rendition
        probe = probe_from_programs(
            program(0, v(0, 1920, 1080, 5000), a(1, 'isl')),
            program(1, v(2, 1920, 1080, 5000), a(3, 'isl')),
            program(2, v(4, 1280, 720, 2500), a(5, 'isl')),
        )
        self.assertEqual(hls.select_streams(probe, 1), (4, 5))

    def test_fewer_than_three_variants(self):
        probe = probe_from_programs(
            program(0, v(0, 1280, 720), a(1)),
            program(1, v(2, 640, 360), a(3)),
        )
        self.assertEqual(hls.select_streams(probe, 0)[0], 0)
        self.assertEqual(hls.select_streams(probe, 1)[0], 2)
        self.assertEqual(hls.select_streams(probe, 2)[0], 2)

    def test_single_variant(self):
        probe = probe_from_programs(program(0, v(0, 1280, 720), a(1)))
        for r in (0, 1, 2):
            self.assertEqual(hls.select_streams(probe, r), (0, 1))

    def test_bitrate_breaks_ties_between_equal_dimensions(self):
        probe = probe_from_programs(
            program(0, v(0, 1280, 720), a(1), bitrate=1500000),
            program(1, v(2, 1280, 720), a(3), bitrate=3000000),
            program(2, v(4, 640, 360), a(5), bitrate=8000000),
        )
        # Resolution dominates; bitrate only orders equal dimensions
        self.assertEqual(hls.select_streams(probe, 0), (2, 3))
        self.assertEqual(hls.select_streams(probe, 1), (0, 1))
        self.assertEqual(hls.select_streams(probe, 2), (4, 5))

    def test_bitrate_is_optional(self):
        probe = probe_from_programs(
            program(0, v(0, 1280, 720), a(1)),
            program(1, v(2, 1920, 1080), a(3)),
        )
        self.assertEqual(hls.select_streams(probe, 0), (2, 3))

    def test_missing_dimensions_still_selectable(self):
        probe = probe_from_programs(
            program(0, {'index': 0, 'codec_type': 'video'}, a(1)),
        )
        self.assertEqual(hls.select_streams(probe, 0), (0, 1))

    def test_attached_picture_is_not_a_variant(self):
        probe = probe_from_programs(program(0, a(0), {
            'index': 1, 'codec_type': 'video', 'width': 3000, 'height': 3000,
            'disposition': {'attached_pic': 1}}))
        self.assertEqual(hls.select_streams(probe, 0), (None, 0))


class TestAudioSelection(unittest.TestCase):
    def test_separate_audio_groups(self):
        # High variants share group "hi" (0 isl, 1 eng); low variant uses "lo"
        hi_isl, hi_eng, lo_isl = a(0, 'isl', 1), a(1, 'eng'), a(2, 'isl', 1)
        probe = probe_from_programs(
            program(0, v(3, 1920, 1080), hi_isl, hi_eng),
            program(1, v(4, 1280, 720), hi_isl, hi_eng),
            program(2, v(5, 640, 360), lo_isl),
        )
        self.assertEqual(hls.select_streams(probe, 0), (3, 0))
        self.assertEqual(hls.select_streams(probe, 1), (4, 0))
        self.assertEqual(hls.select_streams(probe, 2), (5, 2))

    def test_icelandic_dub_preferred_over_default_original(self):
        # Dubbed programme: original English flagged DEFAULT, Icelandic dub not
        probe = probe_from_programs(
            program(0, v(2, 1920, 1080), a(0, 'eng', default=1), a(1, 'isl')))
        self.assertEqual(hls.select_streams(probe, 0), (2, 1))

    def test_accessibility_track_not_preferred(self):
        probe = probe_from_programs(program(
            0, v(2, 1920, 1080),
            a(0, 'isl', default=0, visual_impaired=1),
            a(1, 'isl', default=1)))
        self.assertEqual(hls.select_streams(probe, 0), (2, 1))

    def test_default_disposition_without_language_tags(self):
        probe = probe_from_programs(
            program(0, v(2, 1920, 1080), a(0), a(1, default=1)))
        self.assertEqual(hls.select_streams(probe, 0), (2, 1))

    def test_no_program_information(self):
        # Without programs, fall back to ranking every audio stream
        probe = {'streams': [a(0, 'eng'), v(1, 1280, 720), a(2, 'isl'),
                             v(3, 1920, 1080)]}
        self.assertEqual(hls.select_streams(probe, 0), (3, 2))
        self.assertEqual(hls.select_streams(probe, 1), (1, 2))

    def test_program_without_audio_falls_back_to_global_audio(self):
        probe = probe_from_programs(
            program(0, v(0, 1920, 1080)),
            program(1, a(1, 'isl')),
        )
        self.assertEqual(hls.select_streams(probe, 0), (0, 1))


class TestMapArgsAndFallbacks(unittest.TestCase):
    def test_build_map_args(self):
        self.assertEqual(hls.build_map_args(2, 0),
                         ['-map', '0:2', '-map', '0:0'])
        # Never a lone explicit map that silently drops the other media type
        self.assertEqual(hls.build_map_args(2, None),
                         ['-map', '0:2', '-map', '0:a?'])
        self.assertEqual(hls.build_map_args(None, 0),
                         ['-map', '0:v?', '-map', '0:0'])
        self.assertEqual(hls.build_map_args(None, None), [])

    def test_probe_failure_falls_back_to_ffmpeg_defaults(self):
        def boom(url):
            raise RuntimeError('Server returned 403 Forbidden')
        args, warning = hls.hls_map_args('u.m3u8', 0, probe=boom)
        self.assertEqual(args, [])
        self.assertIn('403 Forbidden', warning)

    def test_ffprobe_missing_falls_back(self):
        def missing(url):
            raise FileNotFoundError('ffprobe')
        args, warning = hls.hls_map_args('u.m3u8', 0, probe=missing)
        self.assertEqual(args, [])
        self.assertTrue(warning)

    def test_empty_probe_falls_back(self):
        args, warning = hls.hls_map_args('u.m3u8', 0, probe=lambda u: {})
        self.assertEqual(args, [])
        self.assertTrue(warning)

    def test_partial_probe_video_only(self):
        probe = {'streams': [v(0, 1280, 720), v(1, 1920, 1080)]}
        args, warning = hls.hls_map_args('u.m3u8', 1, probe=lambda u: probe)
        self.assertEqual(args, ['-map', '0:0', '-map', '0:a?'])
        self.assertIsNone(warning)

    def test_partial_probe_unknown_streams_falls_back(self):
        # Audio found but other streams unidentified: don't risk dropping video
        probe = {'streams': [a(0, 'isl'), {'index': 1}]}
        args, warning = hls.hls_map_args('u.m3u8', 0, probe=lambda u: probe)
        self.assertEqual(args, [])
        self.assertTrue(warning)

    def test_normal_selection(self):
        probe = fixture('ffprobe_hls_audio_group.json')
        args, warning = hls.hls_map_args('u.m3u8', 1, probe=lambda u: probe)
        self.assertEqual(args, ['-map', '0:3', '-map', '0:0'])
        self.assertIsNone(warning)


class TestProbeHls(unittest.TestCase):
    def fake_popen(self, out='', err='', code=0):
        proc = mock.Mock()
        proc.communicate.return_value = (out, err)
        proc.returncode = code
        return mock.patch.object(hls.subprocess, 'Popen', return_value=proc)

    def test_success(self):
        payload = json.dumps(fixture('ffprobe_hls_audio_only.json'))
        with self.fake_popen(out=payload) as popen:
            data = hls.probe_hls('https://x/a.m3u8?t=1')
        self.assertEqual(data['streams'][0]['codec_type'], 'audio')
        cmd = popen.call_args[0][0]
        self.assertEqual(cmd[0], 'ffprobe')
        self.assertIn('-show_programs', cmd)
        self.assertEqual(cmd[-1], 'https://x/a.m3u8?t=1')

    def test_nonzero_exit_raises_with_message(self):
        with self.fake_popen(err='x\nServer returned 404 Not Found\n',
                             code=1):
            with self.assertRaises(RuntimeError) as ctx:
                hls.probe_hls('u.m3u8')
        self.assertIn('404 Not Found', str(ctx.exception))

    def test_invalid_json_raises(self):
        with self.fake_popen(out='not json'):
            with self.assertRaises(RuntimeError):
                hls.probe_hls('u.m3u8')


if __name__ == '__main__':
    unittest.main()
