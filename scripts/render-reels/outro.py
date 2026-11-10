"""Fortune Jobs AI end card: spinning gold logo, golden glow, twinkling stars, coin + twinkle sound.
Output: outro.mp4 (1080x1920, 3.2 s, 30 fps, AAC). Original sound, synthesized here."""
import math, subprocess, sys, wave, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build-outro')
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
os.makedirs(HERE, exist_ok=True)
SVG = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, 'favicon.svg')
W, H, FPS, DUR = 1080, 1920, 30, 3.2
N = int(FPS * DUR)
FONT = os.environ.get('INTER_DIR', '/usr/share/fonts/opentype/inter/')
GOLD = (212, 168, 67)

subprocess.run(['rsvg-convert', '-w', '440', '-h', '440', SVG, '-o', f'{HERE}/logo.png'], check=True)
logo = Image.open(f'{HERE}/logo.png').convert('RGBA')
back = Image.new('RGBA', logo.size, (0, 0, 0, 0))  # coin back: plain gold face
ImageDraw.Draw(back).rounded_rectangle([0, 0, 439, 439], radius=88, fill=(190, 146, 52, 255))

# Background: navy vertical gradient
y = np.linspace(0, 1, H)[:, None]
top, bot = np.array([16, 36, 59]), np.array([10, 22, 38])
bg_arr = (top * (1 - y) + bot * y)[:, None, :].repeat(W, 1).reshape(H, W, 3).astype(np.uint8)
BG = Image.fromarray(bg_arr, 'RGB').convert('RGBA')

title = ImageFont.truetype(FONT + 'Inter-ExtraBold.otf', 92)
sub = ImageFont.truetype(FONT + 'Inter-SemiBold.otf', 50)
rng = np.random.default_rng(7)
stars = [(int(540 + r * math.cos(a)), int(820 + r * math.sin(a)), rng.uniform(0.9, 2.6), rng.uniform(0, 6.28), rng.uniform(14, 30))
         for a, r in zip(rng.uniform(0, 6.28, 30), rng.uniform(300, 430, 30))]
stars = [st for st in stars if st[1] < 1090][:14]

def ease_out(t): return 1 - (1 - t) ** 3

def star(draw, x, y, s, a):
    c = (255, 236, 170, int(255 * a))
    draw.polygon([(x, y - s), (x + s * .22, y - s * .22), (x + s, y), (x + s * .22, y + s * .22),
                  (x, y + s), (x - s * .22, y + s * .22), (x - s, y), (x - s * .22, y - s * .22)], fill=c)

SPIN_END = 1.7
os.makedirs(f'{HERE}/frames', exist_ok=True)
for i in range(N):
    t = i / FPS
    f = BG.copy()
    p = min(t / SPIN_END, 1)
    angle = ease_out(p) * 4 * math.pi           # two full turns, slowing to face front
    scale_in = 0.55 + 0.45 * ease_out(min(t / 0.6, 1))
    c = math.cos(angle)
    face = logo if c >= 0 else back
    w = max(int(440 * abs(c) * scale_in), 2); h = int(440 * scale_in)
    img = face.resize((w, h), Image.LANCZOS)
    # Golden glow, stronger once the coin settles
    glow_a = 0.55 + 0.45 * max(0, min((t - SPIN_END + 0.3) / 0.5, 1)) + 0.08 * math.sin(t * 6)
    g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    gr = int(330 * scale_in)
    gd.ellipse([540 - gr, 820 - gr, 540 + gr, 820 + gr], fill=GOLD + (int(255 * max(0, min(glow_a, 1))),))
    g = g.filter(ImageFilter.GaussianBlur(70))
    f = Image.alpha_composite(f, g)
    f.alpha_composite(img, (540 - w // 2, 820 - h // 2))
    # Light sweep across the logo after it settles
    if SPIN_END < t < SPIN_END + 0.6:
        s = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        x0 = int(320 + (t - SPIN_END) / 0.6 * 440)
        ImageDraw.Draw(s).polygon([(x0, 600), (x0 + 60, 600), (x0 - 40, 1040), (x0 - 100, 1040)], fill=(255, 250, 225, 110))
        s = s.filter(ImageFilter.GaussianBlur(8))
        mask = Image.new('L', (W, H), 0); mask.paste(img.split()[3], (540 - w // 2, 820 - h // 2))
        s.putalpha(Image.fromarray(np.minimum(np.array(s.split()[3]), np.array(mask))))
        f = Image.alpha_composite(f, s)
    d = ImageDraw.Draw(f)
    for (x, y0, sp, ph, sz) in stars:
        a = max(0, math.sin(t * sp * 3 + ph)) * min(1, t / 0.5)
        if a > 0.05: star(d, x, y0, sz * (0.6 + 0.4 * a), a)
    ta = max(0, min((t - 1.5) / 0.5, 1))
    if ta:
        dy = int(30 * (1 - ta))
        d.text((540, 1180 + dy), 'Fortune Jobs AI', font=title, anchor='mm', fill=(255, 255, 255, int(255 * ta)))
        d.text((540, 1290 + dy), 'fortunejobsai.com', font=sub, anchor='mm', fill=GOLD + (int(255 * ta),))
    f.convert('RGB').save(f'{HERE}/frames/{i:03d}.png')

# ---- Sound: coin ring on each half turn + twinkle chime at the end ----
SR = 44100
au = np.zeros(int(SR * DUR))
def ping(t0, freqs, dur, vol, decay):
    n = int(SR * dur); tt = np.arange(n) / SR
    s = sum(np.sin(2 * math.pi * fr * tt) * (0.6 ** k) for k, fr in enumerate(freqs))
    s *= np.exp(-tt * decay) * np.minimum(1, tt * 2000)
    a = int(SR * t0); au[a:a + n] += vol * s[:len(au) - a]
# coin "ching" each time the coin passes edge-on (angle = pi/2 + k*pi)
for k in range(4):
    target = (math.pi / 2 + k * math.pi) / (4 * math.pi)
    p = 1 - (1 - target) ** (1 / 3)
    ping(p * SPIN_END, [2637, 3951, 5274, 7040], 0.5, 0.22 - 0.03 * k, 9)
# final coin ring + twinkle arpeggio
ping(SPIN_END, [2093, 3136, 4186, 6272], 1.2, 0.32, 4)
for j, fr in enumerate([2637, 3136, 3951, 4699, 5274, 6272]):
    ping(SPIN_END + 0.12 + j * 0.07, [fr, fr * 2.01], 0.9, 0.14, 6)
au[-int(SR * 0.3):] *= np.linspace(1, 0, int(SR * 0.3))
au = np.clip(au / max(1, np.abs(au).max()) * 0.85, -1, 1)
with wave.open(f'{HERE}/outro.wav', 'wb') as wv:
    wv.setnchannels(1); wv.setsampwidth(2); wv.setframerate(SR)
    wv.writeframes((au * 32767).astype(np.int16).tobytes())

subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', f'{HERE}/frames/%03d.png', '-i', f'{HERE}/outro.wav',
                '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
                '-shortest', '-movflags', '+faststart', f'{HERE}/outro.mp4'], check=True)
print('done')
