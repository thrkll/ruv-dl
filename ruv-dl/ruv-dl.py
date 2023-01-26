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
print('\033[?25l', end="")

def main():
    ruv_data = get_ruv_data(args.input)
    attributes = media_attributes(ruv_data)

    res = resolution(args.resolution) if args.resolution else '3600kbps'
    filepath = fancy(content_info[2], content_info[3], title)
    if args.subs_only:
        subtitles(content_info[4], filepath)
        graceful_exit()
    elif args.subtitles:
        subtitles(content_info[4], filepath)
    filepath += output(args.format) if args.format else '.mp4'
    exists_checker(filepath)
    download(content_info, res, filepath)
    graceful_exit() 

def graceful_exit():
    # Makes terminal cursor visible again
    print('\033[?25h', end="")
    sys.exit()

def exists_checker(filepath):
    # Checks whether file already exists
    if os.path.isfile(filepath):
        answer = input(f'\n File already exists. Do you want to overwrite? [{clr[3]}y/n{clr[5]}]: ')
        if answer.lower() != 'y':
            graceful_exit()

def ffmpeg_check():
    # Checks whether ffmpeg is in PATH
    if shutil.which('ffmpeg') is None or shutil.which('ffprobe') is None:
        print('\nCould not locate ffmpeg/ffprobe.')
        graceful_exit()

def resolution(arg):
    if arg == '1': res = "500kbps"
    elif arg == '2': res = "800kbps"
    elif arg == '3': res = "1200kbps"
    elif arg == '4': res = "2400kbps"
    elif arg == '5': res = "3600kbps"
    else:
        print(' --resolution can be set to 1, 2, 3, 4 or 5. \n See --help.')
        graceful_exit()
    return res

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

    # ... and anitizes filename
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

def fancy(image_links, description, filename):
    title = filename.split('.')[0]
    if args.fancy:
        # Defines a new folder under content title
        new_folder = './' + filename

        # Checks whether folder already exists
        if os.path.exists(new_folder):
            answer = input(f'\n Fancy folder already exists. Do you want to overwrite? [{clr[3]}y/n{clr[5]}]: ')
            if answer.lower() != 'y':
                graceful_exit()
            try:
                shutil.rmtree(new_folder)
            except PermissionError:
                print('\n Could not delete pre-existing folder. Please close all files.')
                graceful_exit()

        # Makes new folder
        os.makedirs(new_folder)

        # Downloads images and places in folder
        def image_download(suffix, index):
            try:
                r = requests.get(image_links[index])
                open(new_folder + '/' + filename + suffix, 'wb').write(r.content)
            except:
                pass
        image_download('_thumbnail.jpg', 0)
        image_download('_portrait.jpg', 1)

        # Saves description to file
        text_file = new_folder + '/description.txt'
        file = open(text_file, 'x').write(description)

        filepath = filename + '/' + filename

    else:
        filepath = filename

    return filepath

def subtitles(subtitle_url, filepath):
    # Returns if no subtitle link available
    if subtitle_url == None:
        print(f'\n No subtitles available {clr[3]}:({clr[5]}')
        return

    # Downloads subtitle file and converts .vtt file to .srt
    r = requests.get(subtitle_url)
    open(filepath + '.vtt', 'wb').write(r.content)
    os.system(f'ffmpeg -y -loglevel error -i "{filepath}.vtt" "{filepath}.srt"')

    # Removes downloaded .vtt file
    os.remove(filepath + '.vtt')
    print('\n Subtitles downloaded')

def output(format):
    # Checks whether output format is supported by ffmpeg
    format.replace('.', '')
    cmd = 'ffmpeg -formats'
    process = subprocess.Popen(cmd,
                               stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT,
                               universal_newlines=True,
                               shell=True)
    ffmpeg_formats = []
    for line in process.stdout:
        a = line.split()
        if len(a) > 2:
            f = ['D', 'E', 'DE']
            for i in f:
                if i in a[0]:
                    ffmpeg_formats.append(a[1])

    if format not in ffmpeg_formats:
        print('\n Unsupported file format.')
        graceful_exit()

    format = '.' + format
    return format

def download(content_info, res, filepath):
    # Sets resolution
    download_link = content_info[1].replace('2400kbps', res)

    # Finds media duration with ffprobe
    cmd = f'ffprobe "{download_link}"'
    process = subprocess.Popen(cmd,
                               stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT,
                               universal_newlines=True,
                               shell=True)
    for line in process.stdout:
        if 'Duration:' in line:
            h,m,s = line.split('Duration: ')[1][:8].split(':')
            media_duration = int(datetime.timedelta(hours=int(h),
                                                    minutes=int(m),
                                                    seconds=int(s)).total_seconds())
            break

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
    cmd = f'ffmpeg -y -loglevel error -stats -i "{download_link}" -c copy "{filepath}"'
    process = subprocess.Popen(cmd,
                               stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT,
                               universal_newlines=True,
                               shell=True)
    filepath = filepath.split('/')[-1]
    print(f'\n Downloading {clr[3]}{filepath}{clr[5]}...')

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