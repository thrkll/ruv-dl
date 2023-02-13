import argparse
from utils import clr

sample_1 = f''' python ruv-dl.py -i https://ruv.is/spila/content-name/sample/sample -s -f
    {clr[1]}Downloads media in Very good resolution with .srt file and places into a fancy folder{clr[5]}'''
sample_2 = f''' python ruv-dl.py -i https://ruv.is/spila/content-name/sample/sample -r 3 -o my_filename -t avi
    {clr[1]}Downloads media in Okay resolution under "my_filename.avi"{clr[5]}'''


epilog = f' {clr[4]}Examples{clr[5]}: \n {sample_1}\n\n {sample_2}\n'

usage = f' \n {clr[4]}Usage{clr[5]}:\n  ruv-dl.py -i [-r] [-s] [-t] [-o] [-f] [-l] [-h]'

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

group.add_argument('-r', '--resolution',
                    type = str,
                    metavar='\b',
                    help = f'''{clr[1]}1 3600kbps\t1920x1080\rVery good (default)
2 2400kbps\t1280x720\tPretty good
3 1200kbps\t852x480\tOkay{clr[5]}''')

group.add_argument('-s', '--subtitles',
                    action='store_true',
                    help = f'{clr[1]}Downloads .srt subtitle file from RUV if available.{clr[5]}')

group.add_argument('-so', '--subs_only',
                    action='store_true',
                    help = f'{clr[1]}Exclusively downloads a .srt subtitle file if available.{clr[5]}')

group.add_argument('-t', '--format',
                    type = str,
                    metavar = '\b',
                    help = f'\t{clr[1]}Any allowed codec by ffmpeg: mp4 (default), mkv, avi, mp3 etc.{clr[5]}')

group.add_argument('-o','--output',
                    type = str,
                    metavar = '\b',
                    help = f'\t{clr[1]}Specifies output name. Default name is as RUV defines it.{clr[5]}')

group.add_argument('-f', '--fancy',
                    action = 'store_true',
                    help = f'{clr[1]}Places output in a new folder and downloads media-thumbnails.{clr[5]}')

group.add_argument('-l', '--ffmpeg_loc',
                    type = str,
                    metavar = '\b',
                    help = f'{clr[1]}Specify a path for ffmpeg if it is not in $PATH.{clr[5]}')

group.add_argument("-h", "--help",
                   action = "help",
                   help = f'{clr[1]}Shows this help message and exits.{clr[5]}')

args = parser.parse_args()