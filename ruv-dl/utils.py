import os
import sys

# Color config
clr = {
    1 : '\033[90m',         # Grey
    2 : '\033[4;90m',       # Grey underline
    3 : '\033[1;93;40m',    # Yellow
    4 : '\x1b[4;93;40m',    # Yellow underline
    5 : '\033[0m'           # End codec
}

# Hide/show terminal cursor
if os.name == 'nt':
    import msvcrt
    import ctypes

    class _CursorInfo(ctypes.Structure):
        _fields_ = [("size", ctypes.c_int),
                    ("visible", ctypes.c_byte)]

def show_cursor(option) -> None:
    if os.name == 'nt':
        ci = _CursorInfo()
        handle = ctypes.windll.kernel32.GetStdHandle(-11)
        ctypes.windll.kernel32.GetConsoleCursorInfo(handle, ctypes.byref(ci))
        if option is True: 
            ci.visible = True
        elif option is False:
            ci.visible = False
        ctypes.windll.kernel32.SetConsoleCursorInfo(handle, ctypes.byref(ci))
    elif os.name == 'posix':
        if option is True: 
            sys.stdout.write("\033[?25h")
        elif option is False:
            sys.stdout.write("\033[?25l")
        sys.stdout.flush()

# Rounds time 
def round_time(seconds) -> str:
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

# Exits gracefully
def graceful_exit() -> None:
    show_cursor(True)
    sys.exit()