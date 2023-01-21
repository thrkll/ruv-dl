# 	📺 ruv-dl 

[![Python](https://img.shields.io/badge/Python_3-3776AB?logo=python&logoColor=white)](https://opensource.org/licenses/MIT)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](https://opensource.org/licenses/MIT)
[![Release](https://img.shields.io/github/v/release/thrkll/ruv-dl)]()

### Download media content from ruv.is 

`ruv-dl` is a simple Python CLI tool to download media content from ruv.is. 

## ✨ Features

🔹 FFmpeg wrapper to download TV and radio programs from ruv.is given a provided URL

🔹 Optionally include metadata that is used by ruv.is, such as images, text and subtitle files 

🔹 Select video quality and file formats supported by FFmpeg

![ruv-dl download](/img/download.gif)

## ⚡️ Installation 

1. Clone the repository to install `ruv-dl`.

`$ git clone https://github.com/thrkll/ruv-dl.git`

2. Install dependencies.

`$  pip install -r requirements.txt`

## ⚙️ Requirements

🔹Python 3.6+

🔹[FFmpeg](https://ffmpeg.org/download.html) in path


## 📖 Usage 

#### Basic download

Find the link to whatever it is you want to waste your time on. Succeeding the input argument `-i` , paste in the URL. By default, the media file will download under the name RÚV defines it in best given quality. 

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1`

#### Resolution 
By default, `ruv-dl` will download the mediafile at the highest bitrate offered by RÚV (3600kbps). To download at a worse resolution, use the `-r` argument. 5 is best, 1 is worst. 

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -r 4`

#### Folder structure
If you are fancy 🎩 - make sure to include the `-f` argument. This will bundle the media file  in a fancy folder together with all images and text description provided by RÚV. 

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -f`

#### Subtitles
Most video content on ruv.is comes with Icelandic :iceland: subtitles. `ruv-dl` will attempt to download these files and convert them to .srt files. To include them in the download, use the `-s` parameter.

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -f -s`

#### Filetypes
By default, all files will download as .mp4. But for the true snob 🧑‍🎨 `ruv-dl` can use any file format supported by FFmpeg. Use the `-t` argument to specify the format.

`$ python ruv-dl.py -i https://ruv.is/sjonvarp/spila/sample/30726/950qj1 -t mkv`

#### Help argument

When you eventually forget everything you've read here, you can use the `--help` argument. 

![Help argument](/img/help.gif)

 
## ⚒️ Project assistance

Please raise an issue if you run into any trouble or have a feature request. Feel free to contribute and make pull requests. Mark this project with a star ⭐ if you like it and let your friends hear about it. 

## 🚚 Versions

📦 2.0.0 - 01 2023 - CLI version of ruv-dl with argparse

📦 1.0.0 - 09 2019 - Initial release

## ⚠️ Licence

MIT License

Copyright (c) 2023 Þorkell Einarsson

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
