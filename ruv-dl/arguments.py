import argparse
from utils import clr

sample_1 = f''' python ruv-dl.py -i https://ruv.is/spila/content-name/sample/sample -s -f
    {clr[1]}Downloads media in the highest available quality with .srt file and places into a fancy folder{clr[5]}'''
sample_2 = f''' python ruv-dl.py -i https://ruv.is/spila/content-name/sample/sample -r 3 -o my_filename -t avi
    {clr[1]}Downloads media in the third-highest available quality under "my_filename.avi"{clr[5]}'''
sample_3 = f''' python ruv-dl.py -i https://ruv.is/spila/content-name/sample/sample -e all -f
    {clr[1]}Downloads every available episode of the series into one fancy folder{clr[5]}'''


epilog = f' {clr[4]}Examples{clr[5]}: \n {sample_1}\n\n {sample_2}\n\n {sample_3}\n'

usage = f' \n {clr[4]}Usage{clr[5]}:\n  ruv-dl.py -i [-e] [-r] [-s] [-t] [-o] [-f] [-y | -n] [-l] [-h]'

parser = argparse.ArgumentParser(description = usage,
                                 formatter_class = argparse.RawTextHelpFormatter,
                                 add_help = False,
                                 epilog = epilog,
                                 usage=argparse.SUPPRESS)

required = parser.add_argument_group(f' {clr[4]}Required arguments{clr[5]}')
required.add_argument('-i', '--input',
                      help=f'\t{clr[1]}URL of ruv.is content.{clr[5]}',
                      metavar = '\b',
                      required=True)

group = parser.add_argument_group(f' {clr[4]}Optional arguments{clr[5]}')

group.add_argument('-e', '--episodes',
                    type = str,
                    metavar = '\b',
                    help = f'''\t{clr[1]}Downloads several episodes of a series.
all\tEvery available episode
3\tEpisode 3
1-3,5\tEpisodes 1 to 3 and 5
4-\tEpisode 4 and later{clr[5]}''')

group.add_argument('-r', '--resolution',
                    type = str,
                    metavar='\b',
                    help = f'''\t{clr[1]}1\tHighest available quality (default)
2\tSecond-highest available quality
3\tThird-highest available quality
Picks among the stream variants ruv.is offers, ranked by
resolution. Uses the lowest one if fewer are available.{clr[5]}''')

group.add_argument('-s', '--subtitles',
                    action='store_true',
                    help = f'{clr[1]}Downloads .srt subtitle file if available.{clr[5]}')

group.add_argument('-so', '--subs_only',
                    action='store_true',
                    help = f'{clr[1]}Exclusively downloads a .srt subtitle file if available.{clr[5]}')

group.add_argument('-t', '--format',
                    type = str,
                    metavar = '\b',
                    help = f'\t{clr[1]}Any codec allowed by ffmpeg: mp4 (default), mkv, avi, mp3 etc.{clr[5]}')

group.add_argument('-o','--output',
                    type = str,
                    metavar = '\b',
                    help = f'\t{clr[1]}Specifies output name. Default name is as ruv.is defines it.{clr[5]}')

group.add_argument('-f', '--fancy',
                    action = 'store_true',
                    help = f'{clr[1]}Places output in a new folder and downloads media-thumbnails.{clr[5]}')

answers = group.add_mutually_exclusive_group()
answers.add_argument('-y', '--yes',
                    action = 'store_true',
                    help = f'{clr[1]}Overwrites existing files and folders without asking.{clr[5]}')

answers.add_argument('-n', '--no',
                    action = 'store_true',
                    help = f'''{clr[1]}Never overwrites; skips files that already exist.
Handy with -e to fetch only new episodes.{clr[5]}''')

group.add_argument('-l', '--ffmpeg_loc',
                    type = str,
                    metavar = '\b',
                    help = f'\t{clr[1]}Specify a path for ffmpeg if it is not in $PATH.{clr[5]}')

group.add_argument("-h", "--help",
                   action = "help",
                   help = f'{clr[1]}Shows this help message and exits.{clr[5]}')

args = parser.parse_args()