"""
End-to-end check against the real ffmpeg/ffprobe on tiny HLS streams generated
locally (a few seconds of test pattern). Skipped if ffmpeg is not installed.
No network access and no RÚV content is used.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'ruv-dl'))

import hls  # noqa: E402

HAVE_FFMPEG = shutil.which('ffmpeg') and shutil.which('ffprobe')


def run(cmd, cwd):
    subprocess.run(cmd, cwd=cwd, check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def make_audio_group_hls(d):
    """3 video variants sharing an audio group: English (DEFAULT) + Icelandic."""
    run(['ffmpeg', '-v', 'error',
         '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=2',
         '-f', 'lavfi', '-i', 'sine=f=440:duration=2',
         '-f', 'lavfi', '-i', 'sine=f=880:duration=2',
         '-map', '0:v', '-map', '0:v', '-map', '0:v', '-map', '1:a', '-map', '2:a',
         '-filter:v:0', 'scale=160:90', '-filter:v:1', 'scale=640:360',
         '-filter:v:2', 'scale=320:180',
         '-c:v', 'libx264', '-c:a', 'aac',
         '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=isl',
         '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod',
         '-master_pl_name', 'master.m3u8',
         '-var_stream_map',
         'a:0,agroup:aud,language:eng,name:english,default:yes '
         'a:1,agroup:aud,language:isl,name:islenska '
         'v:0,agroup:aud v:1,agroup:aud v:2,agroup:aud',
         'stream_%v.m3u8'], d)
    return os.path.join(d, 'master.m3u8')


def make_audio_only_hls(d):
    run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:duration=2',
         '-c:a', 'aac', '-f', 'hls', '-hls_time', '1',
         '-hls_playlist_type', 'vod', '-master_pl_name', 'master.m3u8',
         '-var_stream_map', 'a:0', 'stream_%v.m3u8'], d)
    return os.path.join(d, 'master.m3u8')


def output_streams(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-of',
                          'json', path], check=True, stdout=subprocess.PIPE,
                         universal_newlines=True).stdout
    return json.loads(out)['streams']


def download(url, res, dest):
    args, warning = hls.hls_map_args(url, res)
    assert warning is None, warning
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', url] + args +
        ['-c:v', 'copy', '-c:a', 'copy', '-async', '1', dest],
        os.path.dirname(dest))


@unittest.skipUnless(HAVE_FFMPEG, 'ffmpeg/ffprobe not available')
class TestRealFfmpeg(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_resolution_levels_keep_icelandic_audio(self):
        url = make_audio_group_hls(self.tmp)
        for res, width in ((0, 640), (1, 320), (2, 160)):
            dest = os.path.join(self.tmp, f'out{res}.mp4')
            download(url, res, dest)
            streams = output_streams(dest)
            video = [s for s in streams if s['codec_type'] == 'video']
            audio = [s for s in streams if s['codec_type'] == 'audio']
            self.assertEqual([s['width'] for s in video], [width])
            self.assertEqual(len(audio), 1)
            self.assertEqual(audio[0]['tags'].get('language'), 'isl')

    def test_audio_only(self):
        url = make_audio_only_hls(self.tmp)
        dest = os.path.join(self.tmp, 'radio.mp4')
        download(url, 0, dest)
        streams = output_streams(dest)
        self.assertEqual([s['codec_type'] for s in streams], ['audio'])


if __name__ == '__main__':
    unittest.main()
