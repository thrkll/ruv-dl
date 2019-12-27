#!/usr/bin/env python
import os, sys, requests

clear = 'cls' if os.name == 'nt' else 'clear'
os.system(clear)

def main():
    link()

def link():
    link.user = input('\n\n    Settu inn RÚV-hlekk: ')
    if 'ruv.is/utvarp/spila/' in link.user:
        pass
    elif 'ruv.is/sjonvarp/spila/' in link.user:
        pass
    else:
        os.system(clear)
        print('\n\n    Hlekkurinn verður að vera á forminu www.ruv.is/sjonvarp/spila/...')
        main()
    api()

def api():
    if len(link.user.split('/')) == 8:
        content_code_1 = link.user.split('/')[-2]
        content_code_2 = link.user.split('/')[-1]
    elif len(link.user.split('/')) == 7:
        try:
            content_code_1 = link.user.split('/')[-1]
            content_code_2 = requests.get('https://api.ruv.is/api/programs/get_ids/' + content_code_1).json()['programs'][0]['episodes'][0]['id']
        except:
            os.system(clear)
            print('\n\n    Ekki tókst að tengjast RÚV...')
            main()
    else:
        os.system(clear)
        print('\n\n    Hlekkurinn er ekki á réttu formi...')
        main()
    try:
        api.data = requests.get('https://api.ruv.is/api/programs/program/' + content_code_1 + '/' + content_code_2, timeout = 5).json()
    except:
        os.system(clear)
        print('\n\n    Ekki tókst að tengjast RÚV...')
        main()
    name()

def name():
    multiple_episodes = api.data['multiple_episodes']
    episode_number = api.data['episodes'][0]['number']
    name.title = api.data['title']
    print(name.title)
    if multiple_episodes == True:
         name.title = '%s %s' % (name.title, episode_number)
    if 'ruv.is/utvarp/spila/' in link.user:
        name.title += '.mp3'
    else:
        name.title += '.mp4'
    file()

def file():
    os.system(clear)
    if os.path.isfile(name.title) == True:
        choice = input('\n\n    1: Halda áfram\n    2: Hætta við\n\n    Skjalið "' + name.title + '" er þegar til: ')
        if choice == '1':
            pass
        elif choice =='2':
            os.system(clear)
            main()
        else:
            file()
    radio()

def radio():
    os.system(clear)
    if 'ruv.is/utvarp/spila/' in link.user:
        print('\n\n    Sæki "' + name.title + '"...\n    ')
        r = requests.get(api.data['episodes'][0]['file'])
        open(name.title + '.mp3', 'wb').write(r.content)
        sys.exit()
    resolution()

def resolution():
    os.system(clear)
    choice = input('\n\n    1: 500 kbps\n    2: 800 kbps\n    3: 1200 kbps\n    4: 2400 kbps (HD720)\n    5: 3600 kbps (HD1080)\n\n    Veldu upplausn: ')
    if choice == '1':
        resolution.quality = "500kbps"
    elif choice == '2':
        resolution.quality = "800kbps"
    elif choice == '3':
        resolution.quality = "1200kbps"
    elif choice == '4':
        resolution.quality = "2400kbps"
    elif choice == '5':
        resolution.quality = "3600kbps"
    else:
        resolution()
    subtitles()

def subtitles():
    os.system(clear)
    if api.data['episodes'][0]['subtitles_url'] != None:
        choice = input('\n\n    1: Já\n    2: Nei\n\n    Textaskjal er í boði fyrir þetta efni. Sækja .srt skrá?: ')
        if choice == '1':
            os.system(clear)
            print("\n\n    Sæki textaskjöl...\n    ")
            r = requests.get(api.data['episodes'][0]['subtitles_url'])
            open(name.title + '.vtt', 'wb').write(r.content)
            os.system('ffmpeg -y -loglevel error -i "' + name.title + '.vtt" "' + name.title[:-4] + '.srt"')
            os.remove(name.title + '.vtt')
        elif choice == '2':
            pass
        else:
            subtitles()
    video()

def video():
    os.system(clear)
    m3u3 = api.data['episodes'][0]['file'].split(':2400')[0].replace('2400kbps', resolution.quality)
    print('\n\n    Sæki "' + name.title + '"...\n    ')
    os.system('ffmpeg -y -loglevel error -stats -i "' + m3u3 + '" -c copy "' + name.title + '"')
    os.system(clear)
    print('\n\n    Búið að sækja "' + name.title + '".\n    ')
try:
    main()
except KeyboardInterrupt:
    os.system(clear)
    try:
        sys.exit(0)
    except SystemExit:
        os._exit(0)
