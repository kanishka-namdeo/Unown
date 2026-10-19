import sys
import time

green_on = "\033[48;5;2m\033[38;5;231m"
reset = "\033[0m"
for i in range(400):
    if i % 40 == 0:
        print(f"{green_on}  {i} pass   0 fail   MARKER-G{i:03d}  " + "x" * 80 + reset)
    else:
        print(f"line {i:03d} " + "y" * ((i % 90) + 5))
    sys.stdout.flush()
    time.sleep(0.004)
