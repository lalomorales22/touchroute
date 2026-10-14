# Generates the app icon (dot buddy on black) and the menu bar template icon.
import math, colorsys
from PIL import Image, ImageDraw, ImageFilter

TONES = [(210, 26), (186, 24), (150, 18), (92, 18), (42, 32), (22, 32), (6, 26), (220, 6), (32, 14), (200, 10)]

def hue(f):  # same muted finger tones the app uses
    h, s = TONES[(f - 1) % 10]
    r, g, b = colorsys.hls_to_rgb(h / 360, 0.76, s / 100)
    return int(r * 255), int(g * 255), int(b * 255)

S = 1024
icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((100, 100, 924, 924), radius=190, fill=255)
bg = Image.new("RGBA", (S, S), (0, 0, 0, 255))
icon.paste(bg, (0, 0), mask)

glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
dots = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd, dd = ImageDraw.Draw(glow), ImageDraw.Draw(dots)
cx = cy = S / 2
ring = []
for i in range(5):  # five fingertips in an arc
    a = math.radians(205 + i * 32.5)
    ring.append((cx + math.cos(a) * 205, cy + 60 + math.sin(a) * 205, 46, hue(i * 2 + 1)))
for i in range(9):  # inner swarm
    a = i * 2.39996
    r = 52 * math.sqrt(i + 1)
    ring.append((cx + math.cos(a) * r * 0.9, cy + 70 + math.sin(a) * r * 0.55, 15 + (i % 3) * 5, hue(i + 1)))
for x, y, r, c in ring:
    gd.ellipse((x - r * 2.2, y - r * 2.2, x + r * 2.2, y + r * 2.2), fill=c + (70,))
    dd.ellipse((x - r, y - r, x + r, y + r), fill=c + (255,))
glow = glow.filter(ImageFilter.GaussianBlur(40))
layer = Image.alpha_composite(glow, dots)
clipped = Image.new("RGBA", (S, S), (0, 0, 0, 0))
clipped.paste(layer, (0, 0), mask)
icon = Image.alpha_composite(icon, clipped)
icon.save("assets/icon.png")

T = 44  # menu bar: black on transparent, macOS tints it
tray = Image.new("RGBA", (T, T), (0, 0, 0, 0))
td = ImageDraw.Draw(tray)
for i in range(5):
    a = math.radians(200 + i * 35)
    x, y = 22 + math.cos(a) * 15, 30 + math.sin(a) * 17
    td.ellipse((x - 4.2, y - 4.2, x + 4.2, y + 4.2), fill=(0, 0, 0, 255))
tray.save("src-tauri/icons/tray.png")
print("ok")
