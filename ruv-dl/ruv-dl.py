from arguments import args
from utils import clr, show_cursor, round_time, graceful_exit
import shutil
import requests
import os
import subprocess
import datetime
import re
import time

if os.name == 'nt':
    os.system('color')

def main():
    show_cursor(False)

    # Checks whether user has ffmpeg/ffprobe in $PATH
    ffmpeg_check()

    # Gets data from the RUV api and defines necessary attributes
    attributes = ruv_attributes(args.input)
    attributes['resolution'] = resolution_setting()
    attributes['file_format'] = format_setting()
    attributes['filepath'] = filepath_setting(attributes)
    attributes['media_duration'] = media_duration(attributes)

    # Optional parameters                      
    if args.subtitles or args.subs_only:
        subtitles(attributes)
    if args.fancy:
        fancy_folder(attributes)

    # Downloads media content
    download(attributes)

    # Our job here is done
    graceful_exit() 

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

def ruv_attributes(url) -> dict:
    attributes = {}

    # 27.12.19  Media slugs can have these structures
    #           .../spila/content-name/XXXXX?ep=ZZZZZZ
    #           .../spila/content-name/XXXXX/ZZZZZZ
    #           .../spila/content-name/XXXXX
    content_ids = url.replace('?ep=', '/').split('/')[-2:]
    api_url = f'https://api.ruv.is/api/programs/program/{"/".join(content_ids)}'
    try:
        data = requests.get(api_url, timeout=5)
        data.raise_for_status()
    except requests.exceptions.HTTPError:
        print('\n Program ID not found. Check if URL is valid.')
        graceful_exit()
    except requests.exceptions.RequestException:
        print('\n Could not connect to ruv.is.')
        graceful_exit()
    ruv_data = data.json()

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

def resolution_setting() -> str:
    valid_resolutions = [1, 2, 3]
    if args.resolution:
        try: 
            resolution = int(args.resolution)
            if resolution not in valid_resolutions:
                raise KeyError
        except (ValueError, KeyError):
            print('\n Resolution can only be set to 1, 2 or 3.')
            print(' Refer to --help.')
            graceful_exit()
    else:
        resolution = valid_resolutions[0]
    
    # Stream index starts at 0
    resolution -= 1
    return resolution

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
            print('\n File format is not supported by ffmpeg.')
            graceful_exit()
        file_format = '.' + file_format
    else:
        file_format = '.mp4'

    return file_format

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
    if os.path.isfile(filepath + title + attributes['file_format']):
        answer = input(f'''\n File already exists. 
        \r Do you want to overwrite? [{clr[3]}y/n{clr[5]}]: ''')
        if answer.lower() != 'y':
            graceful_exit()

    return filepath

def media_duration(attributes):
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
    return media_duration

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

def fancy_folder(attributes) -> None:
    filepath = attributes['filepath']
    
    # Saves images to file
    suffix = ['_thumbnail.jpg', '_portrait.jpg']
    for url in attributes['image_urls']:
        try:
            image = requests.get(url)
            open(filepath + attributes['title'] + suffix[0], 'wb').write(image.content)
        except requests.exceptions.RequestException:
            if url is not None:
                print('\n Could not download image from ruv.is.')
        suffix.pop(0)

    # Saves description text to file
    file = open(f'{filepath}description.txt', 
                'x', 
                encoding='utf8').write(attributes['description'])

def download(attributes):
    media_duration = attributes['media_duration']

    # Progress bar
    def progress(seconds_done, eta):
        bar_len = 50
        filled_len = int(round(bar_len * seconds_done / float(media_duration)))
        percents = round(100.0 * seconds_done / float(media_duration), 1)
        fill_symbol = f'{clr[1]}#{clr[5]}'
        empty_symbol = f'{clr[1]}-{clr[5]}'
        bar = fill_symbol * filled_len + empty_symbol * (bar_len - filled_len)
        print(f'\x1b[2K [{bar}] {percents}% | ETA: {eta}', end='\r')

    # Defines process
    output_title = attributes['title'] + attributes['file_format']
    output_link = attributes['filepath'] + output_title
    cmd = ['ffmpeg', 
           '-y', 
           '-loglevel', 
           'error', 
           '-stats', 
           '-i', 
           f'{attributes["content_url"]}',
           '-c', 
           'copy', 
           f'{output_link}']
    
    # Appends setting for correct stream if applicable
    if attributes['content_url'].endswith('.m3u8'):
        cmd.extend(['-map', f'p:{attributes["resolution"]}'])

    process = subprocess.Popen(cmd,
                               stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT,
                               universal_newlines=True)
    print(f'\n Downloading {clr[3]}{output_title}{clr[5]}...')

    # Measures duration
    start_time = time.time()

    # Download starts here
    for line in process.stdout:
        try:
            h,m,s = line.split('time=')[1][:8].split(':')
            seconds_done = int(datetime.timedelta(hours=int(h),
                                                minutes=int(m),
                                                seconds=int(s)).total_seconds())
            try:
                speed = float(line.split('speed=')[1].replace('x','').strip())
                eta = round_time((media_duration - seconds_done) / speed)
            except (IndexError, ValueError, ZeroDivisionError):
                # It can take a couple of lines for ffmpeg to calculate speed
                eta = 'Unknown'
        except Exception as e:
            print(f'\n An unknown error occurred: \n {line}\n {e}')
            graceful_exit()
        progress(seconds_done, eta)

    # Rounds up time
    duration = round_time(time.time() - start_time)

    # Erases progress bar and prints download summary
    print('\r\033[K')
    print(f' {clr[2]}Download completed in {duration}{clr[5]}')

    graceful_exit() 

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print('\n\n Exiting...')
        graceful_exit()