#!/usr/bin/env python
import os
import sys
import requests
import datetime
import shutil

clear = 'cls' if os.name == 'nt' else 'clear'

if shutil.which('ffmpeg') is not None:
    pass
else:
    print('Til að nota ruv-dl verður að setja upp ffmpeg. ')
    sys.exit()

def main():
    os.system(clear)
    content_type()

def content_type():
    choice = input('\n\n    1: Hlekkur á gamalt efni\n    2: RÚV í beinni\n\n    Setja inn hlekk á gamalt efni eða niðurhala beinni útsendingu RÚV?: ')
    if choice == '1':
        os.system(clear)
        link()
    elif choice == '2':
        os.system(clear)
        resolution()
        live()
    else:
        os.system(clear)
        content_type()

def link():
    link.user = input('\n\n    Settu inn RÚV-hlekk: ')
    if 'ruv.is/utvarp/spila/' in link.user:
        pass
    elif 'ruv.is/sjonvarp/spila/' in link.user:
        pass
    else:
        os.system(clear)
        print('\n\n    Hlekkurinn verður að vera á forminu www.ruv.is/sjonvarp/spila/...')
        link()
    api()

def api():
    # 27.12.19  Links can have the form
    #           .../spila/content-name/XXXXX?ep=ZZZZZZ
    #           .../spila/content-name/XXXXX/ZZZZZZ
    #           .../spila/content-name/XXXXX
    if '?ep=' in link.user:
        content_code_1 = link.user.split('/')[-1].split('?ep=')[0]
        content_code_2 = link.user.split('/')[-1].split('?ep=')[1]
    elif len(link.user.split('/')) == 8:
        content_code_1 = link.user.split('/')[-2]
        content_code_2 = link.user.split('/')[-1]
    elif len(link.user.split('/')) == 7:
        try:
            content_code_1 = link.user.split('/')[-1]
            content_code_2 = requests.get('https://api.ruv.is/api/programs/get_ids/{}'.format(content_code_1), timeout = 5).json()['programs'][0]['episodes'][0]['id']
        except:
            os.system(clear)
            print('\n\n    Ekki tókst að tengjast RÚV...')
            sys.exit()
    else:
        os.system(clear)
        print('\n\n    Hlekkurinn er ekki á réttu formi...')
        link()
    try:
        api.data = requests.get('https://api.ruv.is/api/programs/program/{}/{}'.format(content_code_1, content_code_2), timeout = 5).json()
    except:
        os.system(clear)
        print('\n\n    Ekki tókst að tengjast RÚV...')
        sys.exit()
    name()

def name():
    name.title = api.data['title']
    if api.data['multiple_episodes'] == True:
        name.title = '{} - {}'.format(name.title, api.data['episodes'][0]['title'])
    if 'ruv.is/utvarp/spila/' in link.user:
        name.title += '.mp3'
    else:
        name.title += '.mp4'
    file()

def file():
    os.system(clear)
    if os.path.isfile(name.title) == True:
        choice = input('\n\n    1: Halda áfram\n    2: Hætta við\n\n    Skjalið "{}" er þegar til: '.format(name.title))
        if choice == '1':
            pass
        elif choice =='2':
            os.system(clear)
            sys.exit()
        else:
            file()
    radio()

def radio():
    os.system(clear)
    if 'ruv.is/utvarp/spila/' in link.user:
        try:
            print('\n\n    Sæki {}...\n    '.format(name.title))
            r = requests.get(api.data['episodes'][0]['file'], timeout = 5)
        except:
            os.system(clear)
            print('\n\n    Ekki tókst að tengjast RÚV...')
            main()
        open(name.title, 'wb').write(r.content)
        os.system(clear)
        print('\n\n    Búið að sækja "{}".\n    '.format(name.title))
        sys.exit()
    resolution()
    subtitles()

def resolution():
    os.system(clear)
    choice = input('\n\n    1: 500 kbps\n    2: 800 kbps\n    3: 1200 kbps\n    4: 2400 kbps (HD720)\n    5: 3600 kbps (HD1080)\n\n    Veldu upplausn: ')
    if choice == '1':
        resolution.link = "500kbps"
        resolution.live = "360p"
    elif choice == '2':
        resolution.link = "800kbps"
        resolution.live = "432p"
    elif choice == '3':
        resolution.link = "1200kbps"
        resolution.live = "576p"
    elif choice == '4':
        resolution.link = "2400kbps"
        resolution.live = "720plow"
    elif choice == '5':
        resolution.link = "3600kbps"
        resolution.live = "720phigh"
    else:
        resolution()

def subtitles():
    os.system(clear)
    if api.data['episodes'][0]['subtitles_url'] != None:
        choice = input('\n\n    1: Já\n    2: Nei\n\n    Textaskjal er í boði fyrir þetta efni. Sækja .srt skrá?: ')
        if choice == '1':
            os.system(clear)
            print("\n\n    Sæki textaskjöl...\n    ")
            r = requests.get(api.data['episodes'][0]['subtitles_url'])
            open(name.title + '.vtt', 'wb').write(r.content)
            os.system('ffmpeg -y -loglevel error -i "{}.vtt" "{}.srt"'.format(name.title, name.title[:-4]))
            os.remove(name.title + '.vtt')
        elif choice == '2':
            pass
        else:
            subtitles()
    video()

def video():
    os.system(clear)
    m3u3 = api.data['episodes'][0]['file'].split(':2400')[0].replace('2400kbps', resolution.link)
    print('\n\n    Sæki "{}"...\n\n    '.format(name.title))
    os.system('ffmpeg -y -loglevel error -stats -i "{}" -c copy "{}"'.format(m3u3, name.title))
    # os.system(clear)
    print('\n\n    Búið að sækja "{}".'.format(name.title))


def live():
    os.system(clear)
    m3u8 = 'https://ruvruv-live-hls.secure.footprint.net/ruv/ruv/index/stream{}.m3u8'.format(resolution.live)
    title = datetime.datetime.now().strftime('"Bein útsending RÚV - %d.%m.%Y kl. %H.%M.mp4"')
    print('\n\n    Sæki {}...\n\n    Ýttu á Q til að hætta uppptöku.\n\n    '.format(title))
    os.system('ffmpeg -y -loglevel error -stats -live_start_index -1 -i {} -c copy {}'.format( m3u8, title))
    os.system(clear)
    print('\n\n    Búið að sækja {}.'.format(title))


try:
    main()
except KeyboardInterrupt:
    os.system(clear)
    try:
        sys.exit(0)
    except SystemExit:
        os._exit(0)
