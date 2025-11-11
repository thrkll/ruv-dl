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
    if args.ffmpeg_loc and os.path.exists(args.ffmpeg_loc):
        os.environ['PATH'] += os.pathsep + args.ffmpeg_loc

    # Checks whether ffmpeg/ffprobe is in $PATH
    if shutil.which('ffmpeg') is None or shutil.which('ffprobe') is None:
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
        data.json()['episodes'][0]
    except requests.exceptions.HTTPError:
        print('\n Program ID not found. Check if URL is valid.')
        graceful_exit()
    except requests.exceptions.RequestException:
        print('\n Could not connect to ruv.is.')
        graceful_exit()
    except IndexError:
        print('\n Content is not available.')
        graceful_exit()
    ruv_data = data.json()

    # Title - As RUV defines it...
    title = ruv_data['title']
    if ruv_data.get('multiple_episodes') is True:
        secondary_title = ruv_data['episodes'][0]['title']
        title = f'{title} - {secondary_title}'
    
    # ...unless defined by user with -o flag...
    if args.output:
        title = args.output

    # ... and sanitizes filename
    title = re.sub(r'[^\w_.)( -]', '', title)
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


def resolution_setting() -> int:
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

    # 0 = lowest, 1 = mid, 2 = highest
    return resolution - 1


def format_setting() -> str:
    if args.format:
        file_format = args.format.replace('.', '')

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
                for flag in ('D', 'E', 'DE'):
                    if flag in a[0]:
                        ffmpeg_formats.append(a[1])
                        break

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

def media_duration(attributes) -> float:
    # Finds media duration with ffprobe and checks for geoblock
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
                                stderr=subprocess.PIPE,
                                universal_newlines=True)
    out_lines = process.stdout.readlines()
    err_lines = process.stderr.readlines()
    if not out_lines:
        if any('403 Forbidden' in line for line in err_lines):
            print('\n Not allowed to download. Check if content is geoblocked.')
        else:
            print('\n Unexpected ffprobe error.')
        graceful_exit()

    return float(out_lines[0])

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
    # Save landscape and portrait images with Jellyfin/Plex/Emby naming conventions
    filenames = ['fanart.jpg', 'poster.jpg']

    for url, name in zip(attributes['image_urls'], filenames):
        if url:
            try:
                image = requests.get(url, timeout=5)
                image.raise_for_status()
                with open(filepath + name, 'wb') as f:
                    f.write(image.content)
            except requests.exceptions.RequestException:
                pass

    # Save description to file
    with open(f'{filepath}description.txt', 'w', encoding='utf-8') as file:
        file.write(attributes['description'])


def get_hls_stream_indices(content_url: str, resolution_index: int):
    """
    Use ffprobe to detect available video/audio streams for an HLS URL.
    resolution_index is 0-based (0,1,2,...) and will be clamped.
    Returns (video_stream_index, audio_stream_index) or (None, None) on failure.
    """
    cmd = [
        'ffprobe',
        '-v', 'error',
        '-show_entries', 'stream=index,codec_type,width,height',
        '-of', 'csv=p=0',
        content_url
    ]

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True
    )
    out, err = process.communicate()

    if process.returncode != 0:
        return None, None

    videos = []
    audios = []

    for line in out.strip().splitlines():
        parts = line.split(',')
        if len(parts) < 2:
            continue

        try:
            idx = int(parts[0])
        except ValueError:
            continue

        codec_type = parts[1].strip()

        if codec_type == 'video':
            width = height = 0
            if len(parts) >= 4:
                try:
                    width = int(parts[2])
                    height = int(parts[3])
                except ValueError:
                    pass
            pixels = width * height
            videos.append((idx, pixels))

        elif codec_type == 'audio':
            audios.append(idx)

    if not videos and not audios:
        return None, None

    audio_idx = audios[0] if audios else None

    if not videos:
        return None, audio_idx

    # Sort videos by resolution (pixels); lowest → highest
    videos.sort(key=lambda x: x[1])

    # Clamp resolution_index
    if resolution_index < 0:
        resolution_index = 0
    if resolution_index >= len(videos):
        resolution_index = len(videos) - 1

    video_idx = videos[resolution_index][0]
    return video_idx, audio_idx


def download(attributes) -> None:
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
    is_hls = attributes['content_url'].endswith('.m3u8')

    if is_hls:
        res_idx = attributes['resolution']
        v_idx, a_idx = get_hls_stream_indices(attributes["content_url"], res_idx)

        cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-stats', '-i', attributes["content_url"]]

        # Only map if we detected specific streams; otherwise let ffmpeg choose defaults
        if v_idx is not None:
            cmd.extend(['-map', f'0:{v_idx}'])
        if a_idx is not None:
            cmd.extend(['-map', f'0:{a_idx}'])

        cmd.extend([
            '-c:v', 'copy',
            '-c:a', 'copy',
            '-async', '1',
            output_link
        ])
    else:
        cmd = [
            'ffmpeg',
            '-y',
            '-loglevel', 'error',
            '-stats',
            '-i', attributes["content_url"],
            '-c', 'copy',
            output_link
        ]

    process = subprocess.Popen(cmd,
                               stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT,
                               universal_newlines=True)
    print(f'\n Downloading {clr[3]}{output_title}{clr[5]}...')

    # Measures duration
    start_time = time.time()
    last_lines = []

    for raw_line in process.stdout:
        line = raw_line.rstrip('\n')

        # Keep last lines for error reporting
        last_lines.append(line)
        if len(last_lines) > 30:
            last_lines.pop(0)

        if 'time=' not in line:
            continue

        try:
            time_str = line.split('time=')[1][:8]  # HH:MM:SS
            h, m, s = time_str.split(':')
            seconds_done = int(datetime.timedelta(
                hours=int(h),
                minutes=int(m),
                seconds=int(s)
            ).total_seconds())
        except (IndexError, ValueError):
            continue

        eta = 'Unknown'
        try:
            speed = 1.0
            if 'speed=' in line:
                speed_part = line.split('speed=')[1].split('x')[0].strip()
                if speed_part not in ['', 'N/A']:
                    speed = float(speed_part)
            if speed > 0:
                eta = round_time((media_duration - seconds_done) / speed)
        except (IndexError, ValueError, ZeroDivisionError):
            pass

        progress(seconds_done, eta)

    process.wait()

    # Clear progress bar line
    print('\r\033[K', end='')

    if process.returncode != 0:
        print(f'\n{clr[4]}Error: ffmpeg exited with code {process.returncode}{clr[5]}')
        print('[ERROR] Last ffmpeg output lines:')
        for l in last_lines:
            print('   ', l)
        graceful_exit()

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