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
    ruv_link = input("""
    Settu inn RÚV-hlekk: """)
    if 'ruv.is/sjonvarp/spila/' in ruv_link:
        pass
    else:
        os.system(clear_terminal)
        print("""
    Hlekkurinn verður að vera á forminu www.ruv.is/sjonvarp/spila/...""")
        link()
    ruv_link = ruv_link.split('/')
    ruv_link = ruv_link[-1].split('?ep=')
    global url
    url = 'https://api.ruv.is/api/programs/program/' + ruv_link[0] + '/' + ruv_link[1]
    try:
        _ = requests.get(url, timeout = 5)
    except requests.ConnectionError:
        os.system(clear_terminal)
        sys.exit("""
    Ekki tókst að tengjast RÚV.""")
    api = requests.get(url, timeout = 5)
    api = api.json()
    ruv_link = api['episodes'][0]
    ruv_link = ruv_link['file']
    ruv_link = ruv_link.split(':2400')[0]
    multiple_episodes = api['multiple_episodes']
    episode_number = api['episodes'][0]['number']
    global title
    title = api['title']
    if multiple_episodes == True:
         title = '%s %s' % (title, episode_number)
    else:
        pass
    title = title + '.mp4'
    menu()

def menu():
    os.system(clear_terminal)
    global quality
    choice = input("""
    1: 500kbpps
    2: 800kbps
    3: 1200kbps
    4: 2400kbps (HD720)
    5: 3600kbps (HD1080)

    Veldu upplausn: """)
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
        choice = input("""
    1: Halda áfram
    2: Hætta við

    Skjalið "%s" er þegar til: """ % title)
        if choice == '1':
            pass
        elif choice =='2':
            os.system(clear_terminal)
            link()
        else:
            file()
    download()

def download():
    os.system(clear_terminal)
    m3u3 = ruv_link.replace('2400kbps', quality)
    ffmpeg = 'ffmpeg -y -loglevel error -stats -i "'+m3u3+'" -c:a copy "' + title + '"'
    print()
    print("""
    Sæki """ + title + """...""")
    print()
    os.system(ffmpeg)

main()
