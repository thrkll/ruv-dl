# <img src="img/logo.svg" width="36" height="36" align="absmiddle" alt=""> ruv-dl

[![Python](https://img.shields.io/badge/Python_3-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](https://opensource.org/licenses/MIT)
[![Release](https://img.shields.io/github/v/release/thrkll/ruv-dl)]()

### Download media content from ruv.is

`ruv-dl` is a simple Python command-line tool to download media content from [RÚV](https://ruv.is). If you'd rather not install anything, there is also a [web version](https://ruv-dl.is) that runs in your browser.

## ✨ Features

🔹 FFmpeg wrapper to download TV and radio programs from ruv.is given a provided URL

🔹 Optionally include metadata used by RÚV, such as images, text description and subtitles

🔹 Choose between resolutions offered by RÚV and file formats supported by FFmpeg

🔹 Web version

![ruv-dl download](/img/download.gif)

## 🌐 Web version

Can't be bothered with Python? Paste a ruv.is link into the web version and download it straight from your browser. Nothing to install, no cookies, no tracking, and the video goes straight from RÚV to your computer. 

### 👉 [ruv-dl.is](https://ruv-dl.is)

Like ruv.is itself, it only works from Iceland. It works best in Chrome and Edge. Other browsers keep the whole file in memory until it's done, which is fine unless it's something really long.

Subtitles go into the file as a subtitle track you can switch on in your player (optionally also as a separate `.srt` file), and metadata is stored in the file as well.

Shortcut: when watching or listening to something on ruv.is, add `-dl` to the address (`www.ruv-dl.is/...`) and you land right on the download.

It relies on RÚV letting other websites read its streams, so it might stop working any day. The source lives in [`web/`](web/). To run it locally:

`$ python -m http.server 8000 --directory web` and open http://localhost:8000

## 💻 Command-line tool

The command-line tool does everything the web version does, plus whole series, media server layouts and other file formats.

### ⚡️ Installation

Clone the repository to install `ruv-dl`:

`$ git clone https://github.com/thrkll/ruv-dl`

Install dependencies:

`$  pip install -r requirements.txt`

### ⚙️ Requirements

Python 3.6+

[FFmpeg](https://ffmpeg.org/download.html) in path

### 📖 Usage

#### Basic download

Find the link to whatever it is you want to waste your time on and paste the URL after the input argument `-i`. 

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1`

#### Resolution

By default, `ruv-dl` downloads the highest resolution RÚV offers for the program. To download a smaller file, use the `-r` argument. RÚV streams come in several quality variants. `ruv-dl` ranks the available ones by resolution, highest first: `1` (default) picks the highest, `2` the second-highest and `3` the third-highest. The exact resolutions and bitrates depend on what RÚV provides for each program. If fewer variants exist, the lowest available one is used. `-r` has no effect on audio-only content such as radio.

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -r 2`

#### Series

To download more than one episode, add `-e` with the episodes you want. Any episode URL of the series works, as does the series URL.

| `-e` | Downloads |
| --- | --- |
| `all` | Every episode currently available |
| `3` | Episode 3 |
| `1-3,5` | Episodes 1, 2, 3 and 5 |
| `4-` | Episode 4 and everything after it |

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -e all -f -s`

Episodes are saved as `Series - Episode title`. With `-f`, they all go in one folder named after the series. Running the same command again later adds new episodes to that folder and asks before overwriting ones you already have. Add `-n` (`--no`) to skip existing episodes without being asked, or `-y` (`--yes`) to overwrite them all. This is handy for picking up new episodes:

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -e all -f -n`

The same flags answer the overwrite question for single downloads too. With `-o`, the name you give replaces the series name.

#### Folder structure

If you are fancy 🎩 - make sure to include the `-f` argument. This will bundle the media file in a fancy folder together with all images and text description provided by RÚV.

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -f`

#### Media server

Use `-m` if the files are going into Jellyfin, Plex, Emby etc. Episodes are named and sorted the way those apps expect, with `.nfo` files carrying the title, description, air date and age rating, plus poster, fanart and episode thumbnails:

```
Blæja/
├── tvshow.nfo  poster.jpg  fanart.jpg
└── Season 02/
    ├── poster.jpg
    ├── Blæja - S02E05 - Mömmuskóli.mp4
    ├── Blæja - S02E05 - Mömmuskóli.nfo
    ├── Blæja - S02E05 - Mömmuskóli-thumb.jpg
    └── Blæja - S02E05 - Mömmuskóli.is.srt
```

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -e all -m -s -n`

![ruv-dl series download into a media server layout](/img/series.gif)

RÚV publishes each season as a separate program with a Roman numeral at the end (Blæja **II**), so `ruv-dl` reads that numeral as the season number. Every season then lands in the same series folder. Programs without episodes, such as films, get their own folder: `Film/Film.mp4`. Use `-o` to choose a different series name. `-m` takes the place of `-f` if you use both. Unlike `-f`, it never deletes an existing folder, so new episodes and seasons are simply added to what you already have.

Every download, with or without `-m`, has the title, series name, episode number, description and air date embedded in the file itself.

#### Subtitles

Most video content on ruv.is comes with Icelandic :iceland: subtitles. `ruv-dl` will attempt to download these files and convert them to .srt files. To include them in the download, use the `-s` argument.

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -f -s`

#### Filetypes

By default, all files will download as .mp4. But for the true snob, `ruv-dl` can use any file format supported by FFmpeg. Use the `-t` argument to specify the format.

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -t mkv`

#### Different FFmpeg location 

In the optimal setup, FFMpeg will be available in the `$PATH`. Alternatively you can specify the location of the FFmpeg installation folder using the `-l` argument. 

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -l C:/ffmpeg/`

Note that depending on your FFmpeg build, you might need to link to `../ffmpeg/bin`.

#### Help

When you eventually forget everything you've read here, you can use the `--help` argument.

```
$ python ruv-dl.py --help

 Usage:
  ruv-dl.py -i [-e] [-r] [-s] [-t] [-o] [-f | -m] [-y | -n] [-l] [-h]

 Required arguments:
  -i, --input           URL of ruv.is content.

 Optional arguments:
  -e, --episodes        Downloads several episodes of a series.
                        all     Every available episode
                        3       Episode 3
                        1-3,5   Episodes 1 to 3 and 5
                        4-      Episode 4 and later
  -r, --resolution      1       Highest available quality (default)
                        2       Second-highest available quality
                        3       Third-highest available quality
                        Picks among the stream variants ruv.is offers, ranked by
                        resolution. Uses the lowest one if fewer are available.
  -s, --subtitles       Downloads .srt subtitle file if available.
  -so, --subs_only      Exclusively downloads a .srt subtitle file if available.
  -t, --format          Any codec allowed by ffmpeg: mp4 (default), mkv, avi, mp3 etc.
  -o, --output          Specifies output name. Default name is as ruv.is defines it.
  -f, --fancy           Places output in a new folder and downloads media-thumbnails.
  -m, --media-server    Names and organises files for Jellyfin, Plex, Emby and Kodi:
                        Show/Season 01/Show - S01E02 - Title.mp4 with .nfo files
                        and artwork. Replaces -f.
  -y, --yes             Overwrites existing files and folders without asking.
  -n, --no              Never overwrites; skips files that already exist.
                        Handy with -e to fetch only new episodes.
  -l, --ffmpeg_loc      Specify a path for ffmpeg if it is not in $PATH.
  -h, --help            Shows this help message and exits.

 Examples:
  python ruv-dl.py -i https://ruv.is/spila/content-name/sample/sample -s -f
    Downloads media in the highest available quality with .srt file and places into a fancy folder

  python ruv-dl.py -i https://ruv.is/spila/content-name/sample/sample -r 3 -o my_filename -t avi
    Downloads media in the third-highest available quality under "my_filename.avi"

  python ruv-dl.py -i https://ruv.is/spila/content-name/sample/sample -e all -f
    Downloads every available episode of the series into one fancy folder
```

## 🧪 Tests

Tests run without network access and use only the standard library. If FFmpeg is installed, a few extra tests generate tiny HLS streams locally and download them for real.

`$ python -m unittest discover -s tests`

## ⚒️ Project assistance

Please raise an issue if you have a feature request or run into trouble (not unlikely given frequent changes at ruv.is.) Feel free to contribute and make pull requests. Mark the project with a star ⭐ if you like it, or [buy me a pylsa 🌭](https://buymeacoffee.com/thrkll).

## 🚚 Versions

📦 2.2.0 - 2026 11 - Series download, media server layout with metadata, web version and better quality/audio selection

📦 2.1.3 - 2025 06 - Default image filenames updated for media server compatibility

📦 2.1.0 - 2023 02 - Complete refactoring, new features added

📦 2.0.0 - 2023 01 - CLI version of ruv-dl with argparse

📦 1.0.0 - 2019 09 - Initial release

## ⚠️ Licence

MIT License

Copyright (c) 2025 Þorkell Einarsson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
