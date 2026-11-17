# Demo of a basic download, recorded with VHS (https://github.com/charmbracelet/vhs)
# Run from the repository root:  vhs img/download.tape
# Needs an Icelandic connection, since RÚV only serves its streams there.

Output img/download.gif

Set Shell "bash"
Set FontFamily "Cascadia Mono"
Set FontSize 18
Set Width 1200
Set Height 250
Set Padding 28
Set WindowBar Colorful
Set BorderRadius 10
Set TypingSpeed 35ms
# The site's dark colors: warm black paper, ink text and the red accent
Set Theme { "name": "ruv-dl", "background": "#141311", "foreground": "#f1ebdf", "cursor": "#ff5a3c", "selection": "#3a3631", "black": "#141311", "red": "#ff5a3c", "green": "#9ccf8a", "yellow": "#ff5a3c", "blue": "#8ab4d6", "magenta": "#d79bc6", "cyan": "#8fcfc8", "white": "#f1ebdf", "brightBlack": "#a39b8d", "brightRed": "#ff7a60", "brightGreen": "#b5e0a5", "brightYellow": "#ff5a3c", "brightBlue": "#a6c8e6", "brightMagenta": "#e6b5d8", "brightCyan": "#a8e0da", "brightWhite": "#ffffff" }

# Work in a throwaway folder with a copy of the script, so the download lands there
Hide
# Wait until the shell shows its prompt before typing into it. The first
# keystrokes sometimes get lost while the terminal starts, so spend them on
# empty Enters rather than on the setup line.
Wait
Sleep 1s
Enter
Enter
Wait
Sleep 500ms
Type `export PYTHONUTF8=1 PYTHONDONTWRITEBYTECODE=1 LANG=C.UTF-8 QUOTING_STYLE=literal PS1='\[\e[38;2;163;155;141m\]$ \[\e[0m\]'; D="$(mktemp -d)" && cd "$D" && cp "$OLDPWD"/ruv-dl/*.py . && clear`
Enter
# Fails loudly (times out) if the setup line was mangled
Wait+Screen@10s /^\$\s*$/
Show

Sleep 600ms
Type "python ruv-dl.py -i https://www.ruv.is/sjonvarp/spila/uti-i-umferdinni/27606/878lr8"
Sleep 500ms
Enter
Wait+Screen@120s /Download completed/
Sleep 4s

# Clean up the downloaded files
Hide
Type `cd / && rm -rf "$D"`
Enter
Sleep 1s
