import argparse
import os

# Color config
clr = {
    1 : '\033[90m',         # Grey
    2 : '\033[4;90m',       # Grey underline
    3 : '\033[1;93;40m',    # Yellow
    4 : '\x1b[4;93;40m',    # Yellow underline
    5 : '\033[0m'           # End codec
}

sample_1 = f''' python ruv-dl.py -i https://ruv.is/spila/content-name/sample/sample -s -f
    {clr[1]}Downloads media in Excellent resolution with .srt file and places into a fancy folder{clr[5]}'''
sample_2 = f''' python ruv-dl.py -i https://ruv.is/spila/content-name/sample/sample -r 1 -o my_filename -t avi
    {clr[1]}Downloads media in Bad resolution under "my_filename.avi"{clr[5]}'''


epilog = f' {clr[4]}Examples{clr[5]}: \n {sample_1}\n\n {sample_2}\n'

usage = f' \n {clr[4]}Usage{clr[5]}:\n  ruv-dl.py -i [-r] [-s] [-t] [-o] [-f] [-h]'

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
                    help = f'''{clr[1]}    1 500kbps\tBad
2 800kbps\tLess bad
3 1200kbps\tOkay
4 2400kbps\tPretty good
5 3600kbps\tExcellent (default){clr[5]}''')

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

group.add_argument("-h", "--help",
                   action = "help",
                   help = f'{clr[1]}Shows this help message and exits.{clr[5]}')

args = parser.parse_args()