# 	ruv-dl 

### Download media content from ruv.is 📺

`ruv-dl` is a simple Python CLI tool to download media content from ruv.is. 

## Features

👉 FFmpeg wrapper to download TV and radio programs from ruv.is given a provided URL

👉 Optionally include metadata that is used by ruv.is, such as images, text and subtitle files 

👉 Select video quality and file formats supported by FFmpeg



![ruv-dl download](/img/download.gif)


## Installation 

Clone the repository to install `ruv-dl`:

`$ git clone https://github.com/thrkll/ruv-dl.git`

## Requirements

🐍 Python 3.6+

💽 [FFmpeg](https://ffmpeg.org/download.html) in path




## Usage 

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