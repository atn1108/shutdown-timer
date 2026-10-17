"""Sinh icon cho Shutdown Timer.

Ve o 4x supersample roi thu nho (LANCZOS) de duong cong muot.
Output:
  assets/icon.png  - 256x256 (dung cho cua so + favicon)
  build/icon.ico   - multi-size (dung cho electron-builder / .exe Windows)
"""
from PIL import Image, ImageDraw, ImageFilter
import os

SS = 4                 # supersample factor
S = 256 * SS           # working size
M = 8 * SS             # margin (day mau trong o goc cho Windows)
R = 56 * SS            # ban kinh bo goc

# ---------- nen gradient thang dung (slate nhe o tren -> dark o duoi) ----------
top_color = (28, 39, 63)
bot_color = (12, 19, 36)
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / (S - 1)
    c = tuple(int(top_color[i] + (bot_color[i] - top_color[i]) * t) for i in range(3)) + (255,)
    gd.line([(0, y), (S, y)], fill=c)

mask = Image.new("L", (S, S), 0)          # rounded-square mask
ImageDraw.Draw(mask).rounded_rectangle([M, M, S - M, S - M], radius=R, fill=255)

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
img.paste(grad, (0, 0), mask)

# ---------- glow do mem o trung tam ----------
glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
cx = cy = S // 2
gr = 80 * SS
ImageDraw.Draw(glow).ellipse([cx - gr, cy - gr, cx + gr, cy + gr], fill=(220, 38, 38, 110))
glow = glow.filter(ImageFilter.GaussianBlur(30 * SS))
glow.putalpha(Image.composite(glow.getchannel("A"), Image.new("L", (S, S), 0), mask))
img = Image.alpha_composite(img, glow)

# ---------- ky hieu power (net do, dau tron) ----------
d = ImageDraw.Draw(img)
red = (239, 68, 68, 255)
stroke = 22 * SS
pr = 58 * SS                 # ban kinh vong
cy2 = cy + 6 * SS            # hieu chinh quang (optical center)

# vong cong, khoang thong o tren ~70 do (235..305)
d.arc([cx - pr, cy2 - pr, cx + pr, cy2 + pr], start=-55, end=235, fill=red, width=stroke)

# thanh doc cham vao trong vong, dau tron 2 dau
bar_top = cy2 - pr - stroke // 2 + 2 * SS
bar_bot = cy2 - int(pr * 0.34)
d.line([cx, bar_top, cx, bar_bot], fill=red, width=stroke)
for y in (bar_top, bar_bot):
    d.ellipse([cx - stroke // 2, y - stroke // 2, cx + stroke // 2, y + stroke // 2], fill=red)

# ---------- xuong file ----------
base = os.path.dirname(__file__)
png_path = os.path.join(base, "assets", "icon.png")
ico_path = os.path.join(base, "build", "icon.ico")
os.makedirs(os.path.dirname(png_path), exist_ok=True)
os.makedirs(os.path.dirname(ico_path), exist_ok=True)

img.resize((256, 256), Image.LANCZOS).save(png_path)
img.resize((256, 256), Image.LANCZOS).save(
    ico_path, format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("saved", png_path)
print("saved", ico_path)
