from arguments import clr, args
import shutil
import sys
import requests
import os
import subprocess
import datetime
import re
import time
from pprint import pprint

# Hides terminal cursor
# print('\033[?25l', end="")
os.system('color')

def main():
    # Checks whether user has ffmpeg/ffprobe in $PATH
    ffmpeg_check()

    # Gets data from the RUV api and defines necessary attributes
    ruv_data = get_ruv_data(args.input)
    attributes = media_attributes(ruv_data)
    attributes['filepath'] = filepath_setting(attributes)
    attributes['file_format'] = format_setting()
    attributes['resolution'] = resolution_setting()

    # Optional parameters                      
    if args.subtitles or args.subs_only:
        subtitles(attributes)
    if args.fancy:
        fancy_folder(attributes)

    # Downloads media content
    download(attributes)

    # Our job here is done
    graceful_exit() 

def graceful_exit() -> None:
    # Makes terminal cursor visible again
    print('\033[?25h', end="")
    sys.exit()

def ffmpeg_check() -> None:
    # Adds ffmpeg/ffprobe location to $PATH if specified by user
    if args.ffmpeg_loc:
        if os.path.exists(args.ffmpeg_loc):
            os.environ['PATH'] += os.pathsep + args.ffmpeg_loc

    # Checks whether ffmpeg/ffprobe is in $PATH
    try: 
        if shutil.which('ffmpeg') is None or shutil.which('ffprobe') is None:
            raise TypeError
    except TypeError:
            print('\n Could not locate ffmpeg/ffprobe in $PATH.')
            print(' Refer to --help.')
            graceful_exit()

def resolution_setting() -> str:
    valid_resolutions = [1, 2, 3]
    if args.resolution:
        try:
            if args.resolution not in valid_resolutions:
                raise KeyError
        except KeyError:
            print('\n Resolution can only be set to 1, 2 or 3.')
            print(' Refer to --help.')
            graceful_exit()
        resolution = args.resolution
    else:
        resolution = valid_resolutions[0]
    return resolution

def get_ruv_data(url) -> dict:
# Gets json information about content from the RÚV api
        # 27.12.19  Media slugs can have the following forms
        #           .../spila/content-name/XXXXX?ep=ZZZZZZ
        #           .../spila/content-name/XXXXX/ZZZZZZ
        #           .../spila/content-name/XXXXX

    content_ids = url.replace('?ep=', '/').split('/')[-2:]
    api_url = f'https://api.ruv.is/api/programs/program/{"/".join(content_ids)}'
    try:
        data = requests.get(api_url, timeout=5)
        data.raise_for_status()
    except requests.exceptions.HTTPError:
        print('\nProgram ID not found. Check if URL is valid.')
        graceful_exit()
    except requests.exceptions.RequestException:
        print('\nCould not connect to ruv.is.')
        graceful_exit()
    data = data.json()
    return data

def media_attributes(ruv_data) -> dict:
# Defines media attributes used by other functions
    attributes = {}

    # Title - As RUV defines it...
    title = ruv_data['title']
    if ruv_data['multiple_episodes'] == True:
        secondary_title = ruv_data['episodes'][0]['title']
        title = f'{title} - {secondary_title}'
    
    # ...unless defined by user with -o flag...
    if args.output:
        title = args.output

    # ... and sanitizes filename
    title = re.sub('[^\w_.)( -]', '', title)
    attributes['title'] = title

    # Media content link
    attributes['content_url'] = ruv_data['episodes'][0]['file']

    # Subtitle link
    attributes['subtitle_url'] = ruv_data['episodes'][0]['subtitles_url']

    # Image links
    attributes['image_urls'] = [ruv_data['image'], ruv_data['portrait_image']]

    # Description
    attributes['description'] = '\n'.join(ruv_data['description'])

    return attributes

    # return title, content_link, image_links, description, subtitle_url

def filepath_setting(attributes) -> str:
    title = attributes['title']
    filepath = './'
    if args.fancy:
        # Defines a new folder under content title
        new_folder = './' + title

        # Checks whether folder already exists
        if os.path.exists(new_folder):
            answer = input(f'''\n Fancy folder already exists. 
            \r Do you want to overwrite? [{clr[3]}y/n{clr[5]}]: ''')
            if answer.lower() != 'y':
                graceful_exit()

            # Removes existing folder
            try:
                shutil.rmtree(new_folder)
            except PermissionError:
                print('''\n Could not delete pre-existing folder. 
                \r Please close all open files and folders.''')
                graceful_exit()

        # Makes new folder
        os.makedirs(new_folder)
        filepath = f'{new_folder}/'

    # Checks whether file already exists
    if os.path.isfile(filepath):
        answer = input(f'''\n File already exists. 
        \r Do you want to overwrite? [{clr[3]}y/n{clr[5]}]: ''')
        if answer.lower() != 'y':
            graceful_exit()

    return filepath

def fancy_folder(attributes) -> None:
    filepath = attributes['filepath']
    
    # Saves images to file
    suffix = ['_thumbnail.jpg', '_portrait.jpg']
    for url in attributes['image_urls']:
        try:
            image = requests.get(url)
            open(filepath + attributes['title'] + suffix[0], 'wb').write(image.content)
        except requests.exceptions.RequestException:
            print('\nCould not download image from ruv.is.')
        suffix.pop(0)

    # Saves description text to file
    file = open(f'{filepath}description.txt', 
                'x', 
                encoding='utf8').write(attributes['description'])

def subtitles(attributes) -> None:
    filepath = attributes['filepath']
    output = filepath + attributes['title']

    # Returns if no subtitle link available
    if attributes['subtitle_url'] == None:
        print(f'\n No subtitles available {clr[3]}:({clr[5]}')
        graceful_exit()
    
    # Downloads subtitle file and converts .vtt file to .srt
    r = requests.get(attributes['subtitle_url'])
    open(filepath + '.vtt', 'wb').write(r.content)
    os.system(f'ffmpeg -y -loglevel error -i "{filepath}.vtt" "{output}.srt"')

    # Removes downloaded .vtt file
    os.remove(filepath + '.vtt')
    print('\n Subtitles downloaded')

    # Exits if -so argument is provided
    if args.subs_only:
        graceful_exit()

def format_setting() -> str:
    if args.format:
        file_format = args.format
        file_format.replace('.', '')

        # Checks whether output format is supported by ffmpeg
        cmd = ['ffmpeg', '-formats']
        process = subprocess.Popen(cmd,
                                stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT,
                                universal_newlines=True)
        ffmpeg_formats = []
        for line in process.stdout:
            a = line.split()
            if len(a) > 2:
                f = ['D', 'E', 'DE']
                for i in f:
                    if i in a[0]:
                        ffmpeg_formats.append(a[1])
        if file_format not in ffmpeg_formats:
            print('\n File format is not supported by FFmpeg.')
            graceful_exit()
        file_format = '.' + file_format
    else:
        file_format = '.mp4'

    return file_format

def download(attributes):
    # Finds media duration with ffprobe
    cmd = ['ffprobe', 
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        f'{attributes["content_url"]}']
    process = subprocess.Popen(cmd,
                                stdout=subprocess.PIPE,
                                universal_newlines=True)
    line = process.stdout.readlines()[0]
    try:    
        media_duration = float(line)
    except ValueError as error_message:
        if '403 Forbidden' in line:
            print('\n Not allowed to download. Check if content is geoblocked.')
        else:
            print(f'\n Unexpected error: {error_message}')
        graceful_exit()

    # Progress bar
    def progress(count, total, status=''):
        bar_len = 50
        filled_len = int(round(bar_len * count / float(total)))
        percents = round(100.0 * count / float(total), 1)
        bar = f'{clr[1]}#{clr[5]}' * filled_len + f'{clr[1]}-{clr[5]}' * (bar_len - filled_len)
        print("\r", end="")
        print(' [{}] {}{}'.format(bar, percents, '%'), end='', flush=True)
        
        if percents == 100:
            print("\r", end="")

    # Defines process
    output_title = attributes['title'] + attributes['file_format']
    output_link = attributes['filepath'] + output_title
    
    # Defines map argument for video resolution settings
    if attributes['content_url'].endswith('.m3u8'):
        video_res = f'-map p:{attributes["resolution"]}'
    else:
        video_res = ''
        
    cmd = f'ffmpeg -y -loglevel error -stats -i {attributes["content_url"]} {video_res} -c copy "{output_link}"'

    process = subprocess.Popen(cmd,
                               stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT,
                               universal_newlines=True,
                               shell=True)
    print(f'\n Downloading {clr[3]}{output_title}{clr[5]}...')

    # Measures duration
    start_time = time.time()

    # Download starts here
    for line in process.stdout:
        if 'Unsupported codec' in line:
            print(f'\n Codec is unsupported, got: {args.format}')
            graceful_exit()
        h,m,s = line.split('time=')[1][:8].split(':')
        media_done = int(datetime.timedelta(hours=int(h),
                                            minutes=int(m),
                                            seconds=int(s)).total_seconds())
        progress(media_done, media_duration)

    # Rounds up time
    final_time = time.time() - start_time
    def round_time(seconds):
        seconds = seconds % (24 * 3600)
        hour = round(seconds // 3600)
        seconds %= 3600
        minutes = round(seconds // 60)
        seconds = round(seconds % 60)

        if hour != 0:
            return f'{hour} hour, {minutes} min. and {seconds} sec.'
        elif minutes != 0:
            return f'{minutes} min. and {seconds} sec.'
        else:
            return f'{seconds} sec.'

    duration = round_time(final_time)

    # Erases progress bar
    sys.stdout.write("\033[K")
    print(f'\n {clr[2]}Download completed in {duration}{clr[5]}\n')

    graceful_exit() 

while True:
    try:
        main()
    except KeyboardInterrupt:
        print('\n\n Exiting...')
        graceful_exit()