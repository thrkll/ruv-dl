import argparse
from argparse import RawTextHelpFormatter
import os
os.system('color')

# Color config
grey = '\033[90m'
grey_underl = '\033[4;90m'
comfy = '\033[1;93;40m'
comfy_underl = '\x1b[4;93;40m'
endc = '\033[0m'

sample_1 = f''' python ruv-dl.py -i https://ruv.is/spila/content-name/sample/sample -s -f
    {grey}Downloads media in Excellent resolution with .srt file and places into a fancy folder{endc}'''
sample_2 = f''' python ruv-dl.py -i https://ruv.is/spila/content-name/sample/sample -r 1 -o my_filename -t avi
    {grey}Downloads media in Bad resolution under "my_filename.avi"{endc}'''


epilog = f' {comfy_underl}Examples{endc}: \n {sample_1}\n\n {sample_2}\n'

usage = f' \n {comfy_underl}Usage{endc}:\n  ruv-dl.py -i [-r] [-s] [-t] [-o] [-f] [-h]'

parser = argparse.ArgumentParser(description = usage,
                                 formatter_class = RawTextHelpFormatter,
                                 add_help = False,
                                 epilog = epilog,
                                 usage=argparse.SUPPRESS)

required = parser.add_argument_group(f' {comfy_underl}Required arguments{endc}')
required.add_argument('-i', '--input',
                      help=f'\t{grey}URL of RUV.is content.{endc}',
                      metavar = '\b',
                      required=True)

group = parser.add_argument_group(f' {comfy_underl}Optional arguments{endc}')

group.add_argument('-r', '--resolution',
                    type = str,
                    metavar='\b',
                    help = f'''{grey}    1 500kbps\tBad
2 800kbps\tLess bad
3 1200kbps\tOkay
4 2400kbps\tPretty good
5 3600kbps\tExcellent (default){endc}''')

group.add_argument('-s', '--subtitles',
                    action='store_true',
                    help = f'{grey}Downloads .srt subtitle file from RUV if available.{endc}')

group.add_argument('-so', '--subs_only',
                    action='store_true',
                    help = f'{grey}Exclusively downloads a .srt subtitle file if available.{endc}')

group.add_argument('-t', '--format',
                    type = str,
                    metavar = '\b',
                    help = f'\t{grey}Any allowed codec by ffmpeg: mp4 (default), mkv, avi, mp3 etc.{endc}')

group.add_argument('-o','--output',
                    type = str,
                    metavar = '\b',
                    help = f'\t{grey}Specifies output name. Default name is as RUV defines it.{endc}')

group.add_argument('-f', '--fancy',
                    action = 'store_true',
                    help = f'{grey}Places output in a new folder and downloads media-thumbnails.{endc}')

group.add_argument("-h", "--help",
                   action = "help",
                   help = f'{grey}Shows this help message and exits.{endc}')

args = parser.parse_args()