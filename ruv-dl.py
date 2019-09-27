#!/usr/bin/env python
# coding=utf-8
import os
import sys
import requests

clear_terminal = 'cls' if os.name == 'nt' else 'clear'

def main():
    os.system(clear_terminal)
    link()

def link():
    global ruv_link
    ruv_link = input('\n\n    Settu inn RÚV-hlekk: ')
    if 'ruv.is/sjonvarp/spila/' in ruv_link:
        pass
    else:
        os.system(clear_terminal)
        print('\n\n    Hlekkurinn verður að vera á forminu www.ruv.is/sjonvarp/spila/...')
        link()
    ruv_link = ruv_link.split('/')[-1].split('?ep=')
    global url
    url = 'https://api.ruv.is/api/programs/program/' + ruv_link[0] + '/' + ruv_link[1]
    try:
        _ = requests.get(url, timeout = 5)
    except requests.ConnectionError:
        os.system(clear_terminal)
        sys.exit('\n\n    Ekki tókst að tengjast RÚV.')
    global api
    api = requests.get(url, timeout = 5)
    api = api.json()
    ruv_link = api['episodes'][0]['file'].split(':2400')[0]
    multiple_episodes = api['multiple_episodes']
    episode_number = api['episodes'][0]['number']
    global title
    title = api['title']
    if multiple_episodes == True:
         title = '%s %s' % (title, episode_number)
    else:
        pass
    api = api['episodes'][0]['subtitles_url']
    menu()

def menu():
    os.system(clear_terminal)
    global quality
    choice = input('\n\n    1:  500 kbps\n    2:  800 kbps\n    3: 1200 kbps\n    4: 2400 kbps (HD720)\n    5: 3600 kbps (HD1080)\n\n    Veldu upplausn: ')
    if choice == '1':
        quality = "500kbps"
    elif choice == '2':
        quality = "800kbps"
    elif choice == '3':
        quality = "1200kbps"
    elif choice == '4':
        quality = "2400kbps"
    elif choice == '5':
        quality = "3600kbps"
    else:
        menu()
    file()

def file():
    os.system(clear_terminal)
    if os.path.isfile(title) == True:
        choice = input('\n\n    1: Halda áfram\n    2: Hætta við\n\n    Skjalið ' + title + ' er þegar til: ')
        if choice == '1':
            pass
        elif choice =='2':
            os.system(clear_terminal)
            link()
        else:
            file()
    subtitles()

def subtitles():
    os.system(clear_terminal)
    if api != None:
        choice = input('\n\n    1: Já\n    2: Nei\n\n    Textaskjal er í boði fyrir þetta efni. Sækja .srt skrá?: ')
        if choice == '1':
            os.system(clear_terminal)
            print("\n\n    Sæki textaskjöl...")
            url = api
            r = requests.get(url, allow_redirects=True)
            open(title + '.vtt', 'wb').write(r.content)
            ffmpeg = 'ffmpeg -y -loglevel error -i "' + title + '.vtt" "' + title + '.srt"'
            os.system(ffmpeg)
            os.remove(title + '.vtt')
        elif choice == '2':
            pass
        else:
            subtitles()
    else:
        pass
    download()

def download():
    os.system(clear_terminal)
    m3u3 = ruv_link.replace('2400kbps', quality)
    ffmpeg = 'ffmpeg -y -loglevel error -stats -i "' + m3u3 + '" -c:a copy "' + title + '.mp4"'
    print('\n\n    Sæki ' + title + '...')
    os.system(ffmpeg)

main()
