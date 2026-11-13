# 📺 ruv-dl

[![Python](https://img.shields.io/badge/Python_3-3776AB?logo=python&logoColor=white)](https://opensource.org/licenses/MIT)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](https://opensource.org/licenses/MIT)
[![Release](https://img.shields.io/github/v/release/thrkll/ruv-dl)]()

### Download media content from ruv.is

`ruv-dl` is a simple Python command-line  tool to download media content from [RÚV](https://ruv.is).

> **🌐 No Python? Use the web version: [thrkll.github.io/ruv-dl](https://thrkll.github.io/ruv-dl/)**
> Paste a ruv.is link and download. Nothing to install. [More below](#-web-version-experimental).

## ✨ Features

🔹 FFmpeg wrapper to download TV and radio programs from ruv.is given a provided URL

🔹 Optionally include metadata that is used by RÚV, such as images, text description and subtitle files

🔹 Choose between resolutions offered by RÚV and file formats supported by FFmpeg

![ruv-dl download](/img/download.svg)

## 🌐 Web version (experimental)

### 👉 [thrkll.github.io/ruv-dl](https://thrkll.github.io/ruv-dl/)

Don't want to install anything? Open the link above, paste a ruv.is link, pick an episode and quality, and download an `.mp4` with subtitles. It runs entirely in your browser: nothing is installed, and the video comes straight from RÚV to your computer.

- Works best in Chrome and Edge, which save straight to disk. Firefox and Safari keep the file in memory until it is finished, which is fine for single episodes.
- The page may only contact RÚV's servers (enforced by a Content Security Policy). Its one library, [mux.js](https://github.com/videojs/mux.js), is pinned and checked with a hash.
- It relies on RÚV allowing other websites to read its streams, which RÚV could change at any time.

The source is in [`web/`](web/). To run this locally:

`$ python -m http.server 8000` and open http://localhost:8000


## ⚡️ Installation

Clone the repository to install `ruv-dl`:

`$ git clone https://github.com/thrkll/ruv-dl`

Install dependencies:

`$  pip install -r requirements.txt`

## ⚙️ Requirements

Python 3.6+

[FFmpeg](https://ffmpeg.org/download.html) in path

## 📖 Usage

### Basic download

Find the link to whatever it is you want to waste your time on and paste the URL after the input argument `-i`. 

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1`

### Resolution

By default, `ruv-dl` downloads the highest resolution RÚV offers for the program. To download a smaller file, use the `-r` argument. RÚV streams come in several quality variants. `ruv-dl` ranks the available ones by resolution, highest first: `1` (default) picks the highest, `2` the second-highest and `3` the third-highest. The exact resolutions and bitrates depend on what RÚV provides for each program. If fewer variants exist, the lowest available one is used. `-r` has no effect on audio-only content such as radio.

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -r 2`

### Series

To download more than one episode, add `-e` with the episodes you want. Any episode URL of the series works, as does the series URL.

| `-e` | Downloads |
| --- | --- |
| `all` | Every episode currently available |
| `3` | Episode 3 |
| `1-3,5` | Episodes 1, 2, 3 and 5 |
| `4-` | Episode 4 and everything after it |

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -e all -f -s`

Episodes are saved as `Show - Episode title`. With `-f`, they all go in one folder named after the show. Running the same command again later adds new episodes to that folder and asks before overwriting ones you already have. Add `-n` (`--no`) to skip existing episodes without being asked, or `-y` (`--yes`) to overwrite them all. This is handy for picking up new episodes:

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -e all -f -n`

The same flags answer the overwrite question for single downloads too. With `-o`, the name you give replaces the show name.

### Folder structure

If you are fancy 🎩 - make sure to include the `-f` argument. This will bundle the media file in a fancy folder together with all images and text description provided by RÚV.

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -f`

### Media server

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

RÚV publishes each season as a separate program with a Roman numeral at the end (Blæja **II**), so `ruv-dl` reads that numeral as the season number. Every season then lands in the same show folder. Programs without episodes, such as films, get their own folder: `Film/Film.mp4`. Use `-o` to choose a different show name. `-m` replaces `-f`, and existing folders are never deleted.

Every download, with or without `-m`, has the title, show, episode number, description and air date embedded in the file itself.

### Subtitles

Most video content on ruv.is comes with Icelandic :iceland: subtitles. `ruv-dl` will attempt to download these files and convert them to .srt files. To include them in the download, use the `-s` argument.

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -f -s`

### Filetypes

By default, all files will download as .mp4. But for the true snob, `ruv-dl` can use any file format supported by FFmpeg. Use the `-t` argument to specify the format.

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -t mkv`

### Different FFmpeg location 

In the optimal setup, FFMpeg will be available in the `$PATH`. Alternatively you can specify the location of the FFmpeg installation folder using the `-l` argument. 

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -l C:/ffmpeg/`

Note that depending on your FFmpeg build, you might need to link to `../ffmpeg/bin`.

### Help

When you eventually forget everything you've read here, you can use the `--help` argument.

![Help argument](/img/help.svg)

## 🧪 Tests

Tests run without network access and use only the standard library. If FFmpeg is installed, a few extra tests generate tiny HLS streams locally and download them for real.

`$ python -m unittest discover -s tests`

## ⚒️ Project assistance

Please raise an issue if you have a feature request or run into trouble (not unlikely given frequent changes at ruv.is.) Feel free to contribute and make pull requests. Mark the project with a star ⭐ if you like it.

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
