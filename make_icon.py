from PIL import Image, ImageDraw
import os

S = 256
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded dark background (slate-900 gradient-ish: solid + lighter top arc)
d.rounded_rectangle([8, 8, S - 8, S - 8], radius=56, fill=(15, 23, 42, 255))
d.rounded_rectangle([8, 8, S - 8, S // 2], radius=56, fill=(22, 33, 58, 255))

# Red ring (progress arc)
box = [40, 40, S - 40, S - 40]
d.arc(box, start=-45, end=235, fill=(239, 68, 68, 255), width=18)
# dim track for rest of circle
d.arc(box, start=235, end=315, fill=(255, 255, 255, 25), width=18)

# Power symbol: circle gap + vertical line
cx, cy = S // 2, S // 2 + 6
r = 42
d.arc([cx - r, cy - r, cx + r, cy + r], start=-60, end=240, fill=(255, 255, 255, 255), width=16)
d.line([cx, cy - r - 16, cx, cy - 2], fill=(255, 255, 255, 255), width=16)

out = os.path.join(os.path.dirname(__file__), "assets", "icon.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
img.save(out)
print("saved", out)
