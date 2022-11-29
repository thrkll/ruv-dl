from arguments import *
import shutil
import sys
import requests
import os
import subprocess
import datetime
import re
import time

os.system('color')

def main():
    ffmpeg_check()

    res = resolution(args.resolution) if args.resolution else '3600kbps'
    content_ids = url_data(args.input)
    json_data = api_getter(content_ids)
    content_info = media_info(json_data)

    title = content_info[0]
    title = re.sub('[^\w_.)( -]', '', title)

    filepath = fancy(content_info[2], content_info[3], title)
    if args.subs_only:
        subtitles(content_info[4], filepath)
        sys.exit()
    elif args.subtitles:
        subtitles(content_info[4], filepath)

    filepath += output(args.format) if args.format else '.mp4'

    filechecker(filepath)

    download(content_info, res, filepath)

def filechecker(filepath):
    # Checks whether file already exists
    if os.path.isfile(filepath) == True:
        print('\n File already exists.')
        answer = input(f' Do you want to overwrite? [{comfy}y/n{endc}]: ')
        if answer.lower() != 'y':
            sys.exit()

def ffmpeg_check():
    # Checks whether ffmpeg is in PATH
    if shutil.which('ffmpeg') is None or shutil.which('ffprobe') is None:
        print('\nCould not locate ffmpeg/ffprobe.')
        sys.exit()

def resolution(arg):
    if arg == '1': res = "500kbps"
    elif arg == '2': res = "800kbps"
    elif arg == '3': res = "1200kbps"
    elif arg == '4': res = "2400kbps"
    elif arg == '5': res = "3600kbps"
    else:
        print(' --resolution can be set to 1, 2, 3, 4 or 5. \n See --help.')
        sys.exit()
    return res

def url_data(arg):
    # URL validation
        # 27.12.19  Links can have the form
        #           .../spila/content-name/XXXXX?ep=ZZZZZZ
        #           .../spila/content-name/XXXXX/ZZZZZZ
        #           .../spila/content-name/XXXXX
    try:
        content_url = arg.split('ruv.is')[1]
        if '?ep=' in content_url:
            content_url = content_url.replace('?ep=', '/')
        content_ids = content_url.split('/')[-2:]

    except:
        print('\n Input URL is not valid.')
        sys.exit()

    return content_ids

def api_getter(content_ids):
    # Retrieves media data from RUV api
    ids = "/".join(content_ids)
    api_url = f'https://api.ruv.is/api/programs/program/{ids}'
    try:
        data = requests.get(api_url, timeout=5).json()
    except:
        print('\nCould not connect to RUV.is.')
        sys.exit()

    if not 'title' in data:
        print('\n Program ID not found. Check if URL is valid.')
        sys.exit()

    return data

def media_info(data):
    try:
        # Defines title as RUV defines it...
        title = data['title']
        if data['multiple_episodes'] == True:
            secondary_title = data['episodes'][0]['title']
            title = f'{title} - {secondary_title}'

        # ...unless user defined by -o flag
        if args.output:
            title = args.output

        content_link = ':'.join(data['episodes'][0]['file'].split(':')[:2])
        image_links = [data['image'], data['portrait_image']]
        description = data['description']

        # Concatenates, in case description is stored in multiple lines
        description = '\n'.join(description)
        subtitle_url = data['episodes'][0]['subtitles_url']
    except:
        print('\n Content not available.')
        sys.exit()

    return title, content_link, image_links, description, subtitle_url

def fancy(image_links, description, filename):
    title = filename.split('.')[0]
    if args.fancy:
        # Defines a new folder under content title
        new_folder = './' + filename

        # Checks whether folder already exists
        if os.path.exists(new_folder):
            answer = input(f'\n Fancy folder already exists. \n Do you want to overwrite? [{comfy}y/n{endc}]: ')
            if answer.lower() != 'y':
                sys.exit()
            try:
                shutil.rmtree(new_folder)
            except PermissionError:
                print('\n Could not delete pre-existing folder. Please close all files.')
                sys.exit()

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
        print(f'\n No subtitles available {comfy}:({endc}')
        return

    # Downloads subtitle file and converts .vtt file to .srt
    r = requests.get(subtitle_url)
    open(filepath + '.vtt', 'wb').write(r.content)
    os.system(f'ffmpeg -y -loglevel error -i "{filepath}.vtt" "{filepath}.srt"')

    # Removes downloaded .vtt file
    os.remove(filepath + '.vtt')
    print('\n Subtitles downloaded.')

def output(format):
    # Checks whether output format is supported by ffmpeg
    format.replace('.', '')
    cmd = 'ffmpeg -formats'
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

    if format not in ffmpeg_formats:
        print('\n Unsupported file format.')
        sys.exit()

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
                               universal_newlines=True)
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
        bar = f'{grey}#{endc}' * filled_len + f'{grey}-{endc}' * (bar_len - filled_len)
        print(' [{}] {}{} {}'.format(bar, percents, '%', '\b'*400), end='', flush=True)

    # Defines process
    cmd = f'ffmpeg -y -loglevel error -stats -i "{download_link}" -c copy "{filepath}"'
    process = subprocess.Popen(cmd,
                               stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT,
                               universal_newlines=True)
    filepath = filepath.split('/')[-1]
    print(f'\n Downloading {comfy}{filepath}{endc}...')

    # Measures duration
    start_time = time.time()

    # Download starts here
    for line in process.stdout:
        if 'Unsupported codec' in line:
            print(f'\n Codec is unsupported, got: {args.format}')
            sys.exit()
        h,m,s = line.split('time=')[1][:8].split(':')
        media_done = int(datetime.timedelta(hours=int(h),
                                            minutes=int(m),
                                            seconds=int(s)).total_seconds())
        progress(media_done, media_duration)

    sys.stdout.write("\033[K")

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

    sys.stdout.write("\033[K")
    print(f'\n {grey_underl}Download completed in {duration}{endc}\n', end='\r', flush=True)

    sys.exit()  

while True:
    try:
        main()
    except KeyboardInterrupt:
        print('\n\n Exiting...')
        sys.exit()