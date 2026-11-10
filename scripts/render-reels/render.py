"""Render Fortune Jobs AI's social photos, original loops and Reels."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
import wave
from xml.etree import ElementTree

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SOCIAL = ROOT / "social"
FONT = Path(__file__).with_name("fonts") / "Inter.ttf"
GOLD = "#D4A843"
NAVY = "#10243b"
FPS = 12
DURATION = 9.5
SAMPLE_RATE = 44100


@lru_cache
def font(size, weight=650):
    face = ImageFont.truetype(str(FONT), size)
    face.set_variation_by_axes([min(32, max(14, size)), weight])
    return face


def wrap(draw, text, face, width):
    lines = [""]
    for word in text.split():
        line = f"{lines[-1]} {word}".strip()
        if lines[-1] and draw.textlength(line, font=face) > width:
            lines.append(word)
        else:
            lines[-1] = line
    return lines


def fitted(draw, text, width, maximum, minimum, max_lines, weight):
    for size in range(maximum, minimum - 1, -2):
        face = font(size, weight)
        lines = wrap(draw, text, face, width)
        if len(lines) <= max_lines and all(draw.textlength(line, font=face) <= width for line in lines):
            return face, lines, round(size * 1.1)
    raise ValueError(f"Text will not fit: {text}")


@lru_cache
def logo(size):
    """Rasterize the repo logo's rounded square, line and four nodes."""
    svg = ElementTree.parse(ROOT / "favicon.svg").getroot()
    ns = {"s": "http://www.w3.org/2000/svg"}
    rect = svg.find("s:rect", ns)
    group = svg.find("s:g", ns)
    path = group.find("s:path", ns)
    ax, ay, sx, sy, bx, by = map(float, re.findall(r"-?\d+(?:\.\d+)?", group.get("transform")))
    x, y, width, height = map(float, svg.get("viewBox").split())
    scale = size * 3 / width
    image = Image.new("RGBA", (size * 3, size * 3))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, size * 3 - 1, size * 3 - 1),
                           radius=float(rect.get("rx")) * scale, fill=rect.get("fill"))

    def xy(px, py):
        return ((ax + (px + bx) * sx - x) * scale, (ay + (py + by) * sy - y) * scale)

    coords = list(map(float, re.findall(r"-?\d+(?:\.\d+)?", path.get("d"))))
    stroke = path.get("stroke")
    draw.line([xy(*pair) for pair in zip(coords[::2], coords[1::2])],
              fill=stroke, width=round(float(path.get("stroke-width")) * abs(sx) * scale))
    for circle in group.findall(".//s:circle", ns):
        cx, cy = xy(float(circle.get("cx")), float(circle.get("cy")))
        radius = float(circle.get("r")) * abs(sx) * scale
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=stroke)
    return image.resize((size, size), Image.Resampling.LANCZOS)


@lru_cache
def background(height, dark):
    colors = ((16, 36, 59), (23, 76, 120)) if dark else ((252, 248, 237), (243, 231, 202))
    image = Image.new("RGB", (1080, height))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        fraction = y / height
        draw.line((0, y, 1080, y), fill=tuple(
            round(a + (b - a) * fraction) for a, b in zip(*colors)))
    draw.ellipse((620, -180, 1260, 460), fill="#30434b" if dark else "#f4e8cd")
    return image


def brand(draw, layer, x, y, color, size=86):
    layer.paste(logo(size), (x, y), logo(size))
    face = font(40, 800)
    name = "Fortune Jobs "
    draw.text((x + size + 20, y + size / 2), name, font=face, fill=color, anchor="lm")
    draw.text((x + size + 20 + draw.textlength(name, font=face), y + size / 2),
              "AI", font=face, fill=GOLD, anchor="lm")


def kicker(draw, x, y, label):
    face = font(29, 800)
    width = round(draw.textlength(label, font=face)) + 52
    draw.rounded_rectangle((x, y, x + width, y + 60), 30, fill=GOLD)
    draw.text((x + 26, y + 30), label, font=face, fill=NAVY, anchor="lm")


def point(draw, x, y, width, text, dark):
    face, lines, line_height = fitted(draw, text, width - 120, 40, 34, 2, 650)
    height = max(98, len(lines) * line_height + 34)
    draw.rounded_rectangle((x, y, x + width, y + height), 22,
                           fill="#294c68" if dark else "#fffdfa")
    cy = y + height / 2
    draw.ellipse((x + 30, cy - 23, x + 76, cy + 23), fill=GOLD)
    draw.line(((x + 43, cy), (x + 50, cy + 7), (x + 64, cy - 8)),
              fill=NAVY, width=5, joint="curve")
    for i, line in enumerate(lines):
        draw.text((x + 96, cy + (i - (len(lines) - 1) / 2) * line_height),
                  line, font=face, fill="#e1edf7" if dark else "#3a485b", anchor="lm")
    return height


def photo(post):
    dark = post["id"] % 2 == 1
    ink = "#ffffff" if dark else NAVY
    im = background(1350, dark).copy()
    draw = ImageDraw.Draw(im)
    brand(draw, im, 84, 90, ink)
    kicker(draw, 84, 286, post["kicker"])
    face, lines, advance = fitted(draw, post["title"], 912, 92, 60, 3, 830)
    y = 384
    for line in lines:
        draw.text((84, y), line, font=face, fill=ink, anchor="lt")
        y += advance
    y += 42
    for text in post["points"]:
        y += point(draw, 84, y, 912, text, dark) + 22
    if y > 1218:
        raise ValueError(f"Photo layout exceeds content area for post {post['id']}")
    draw.rectangle((0, 1218, 1080, 1350), fill="#133652" if dark else "#e8dfc9")
    draw.text((84, 1285), "fortunejobsai.com", font=font(38, 770), fill=ink, anchor="lm")
    draw.text((996, 1285), "Free to use →", font=font(36, 740),
              fill=GOLD if dark else "#85570b", anchor="rm")
    im.save(SOCIAL / f"post-{post['id']:02}.jpg", quality=93, subsampling=0, optimize=True)


def overlay(paint):
    layer = Image.new("RGBA", (1080, 1920))
    paint(ImageDraw.Draw(layer), layer)
    bbox = layer.getbbox()
    return layer.crop(bbox), bbox[:2]


def reel_layers(post):
    dark = post["id"] % 2 == 1
    ink = "#ffffff" if dark else NAVY
    left, width = 84, 832
    layers = [
        (0.0, overlay(lambda d, im: brand(d, im, left, 212, ink))),
        (0.35, overlay(lambda d, im: kicker(d, left, 372, post["kicker"]))),
    ]

    def draw_title(draw, _):
        for i, line in enumerate(lines):
            draw.text((left, 485 + i * advance), line, font=face, fill=ink, anchor="lt")

    measuring = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    face, lines, advance = fitted(measuring, post["title"], width, 85, 60, 3, 830)
    layers.append((0.68, overlay(draw_title)))
    y = 485 + len(lines) * advance + 66
    points = post.get("points") or [post["reasons"][i][1] for i in (0, 1, 4)]
    for start, text in zip((1.50, 2.60, 3.70), points, strict=True):
        item = overlay(lambda d, im: point(d, left, y, width, text, dark))
        layers.append((start, item))
        y += item[0].height + 24
    if y > 1530:
        raise ValueError(f"Reel layout exceeds safe area for post {post['id']}")
    return dark, layers


@lru_cache
def end_card():
    image = background(1920, True).copy()
    draw = ImageDraw.Draw(image)
    left, right = 84, 916
    mid = (left + right) // 2
    draw.rounded_rectangle((left, 482, right, 1260), 48, fill="#142d47", outline="#43617b", width=2)
    image.paste(logo(145), (mid - 72, 602), logo(145))
    draw.text((mid, 840), "Free at", font=font(58, 740), fill=GOLD, anchor="mm")
    draw.text((mid, 940), "fortunejobsai.com", font=font(69, 830), fill="white", anchor="mm")
    draw.text((mid, 1054), "Find jobs and build your résumé", font=font(34, 550),
              fill="#d7e6f4", anchor="mm")
    return image


def reel_frames(post):
    dark, layers = reel_layers(post)
    cache = {}
    for frame in range(round(DURATION * FPS)):
        time = frame / FPS
        state = tuple(min(3, max(0, math.floor((time - start) * 15) + 1))
                      if time >= start else 0 for start, _ in layers)
        end = min(4, max(0, round((time - 7) * 14)))
        key = (state, end)
        if key not in cache:
            if end == 4:
                image = end_card()
            else:
                image = background(1920, dark).copy()
                for step, (_, (layer, (x, y))) in zip(state, layers):
                    if step:
                        opacity = (step / 3) ** 0.75
                        mask = layer.getchannel("A").point(lambda value: round(value * opacity))
                        image.paste(layer, (x, y + 10 * (3 - step)), mask)
                if end:
                    image = Image.blend(image, end_card(), end / 4)
            # Keep only the previous rendered frame. The longest holds repeat the same state.
            cache = {key: image.tobytes()}
        yield cache[key]


def ffmpeg(*args, **kwargs):
    return subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
                          check=True, **kwargs)


def note(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def synth_loop(number, bpm, root, progression, melody, temp_dir):
    """Compose one four-bar instrumental from additive synthesis and seeded noise."""
    beat = 60 / bpm
    samples = np.zeros((round(16 * beat * SAMPLE_RATE), 2))
    rng = np.random.default_rng(1126 + number)

    def add(sound, at, volume, pan=0):
        start = round(at * beat * SAMPLE_RATE)
        indices = (start + np.arange(len(sound))) % len(samples)
        for channel, gain in enumerate((1 - pan, 1 + pan)):
            np.add.at(samples[:, channel], indices, sound * volume * gain)

    def pluck(pitch, duration, tone):
        t = np.arange(round(duration * beat * SAMPLE_RATE)) / SAMPLE_RATE
        phase = 2 * np.pi * note(pitch) * t
        envelope = np.minimum(t / .008, 1) * np.exp(-t * tone)
        envelope *= np.minimum((t[-1] - t) / .025, 1)
        return (np.sin(phase) + .19 * np.sin(2 * phase) + .07 * np.sin(3 * phase)) * envelope

    for bar, (degree, third) in enumerate(progression):
        start = bar * 4
        for b in (0, 1.5, 2.5, 3.5):
            add(pluck(root - 24 + degree, .44, 9), start + b, .22)
        for b in (0.5, 2):
            for i, interval in enumerate((0, third, 7)):
                add(pluck(root - 12 + degree + interval, 1.3, 5), start + b,
                    .08, pan=(i - 1) * .28)
        for i, interval in enumerate(melody[bar]):
            add(pluck(root + interval, .64, 12), start + .25 + i * .87,
                .16, pan=.23 if i % 2 else -.23)
        for b in (0, 2, 3.5):
            t = np.arange(round(.21 * SAMPLE_RATE)) / SAMPLE_RATE
            kick = np.sin(2 * np.pi * (45 * t + 5 * (1 - np.exp(-20 * t))))
            add(kick * np.exp(-24 * t) * np.minimum(t / .004, 1), start + b, .35)
        for b in np.arange(0, 4, .5):
            t = np.arange(round(.085 * SAMPLE_RATE)) / SAMPLE_RATE
            noise = np.diff(rng.standard_normal(len(t) + 1)) * np.exp(-65 * t)
            add(noise * np.minimum(t / .003, 1), start + b, .034 if b % 1 else .022, .27)
        for b in (1, 3):
            t = np.arange(round(.16 * SAMPLE_RATE)) / SAMPLE_RATE
            noise = rng.standard_normal(len(t)) * np.exp(-31 * t)
            clap = noise + .22 * np.sin(2 * np.pi * 174 * t) * np.exp(-27 * t)
            add(clap * np.minimum(t / .004, 1), start + b, .095)

    samples = np.tanh(samples)
    samples *= .72 / np.max(np.abs(samples))
    wav_path = Path(temp_dir) / f"loop-{number}.wav"
    with wave.open(str(wav_path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes((samples * 32767).astype("<i2").tobytes())
    ffmpeg("-i", str(wav_path), "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
           str(SOCIAL / "music" / f"loop-{number}.m4a"))


def music():
    loops = [
        (104, 72, [(0, 4), (7, 4), (9, 3), (5, 4)],
         [(0, 4, 7, 9), (7, 11, 9, 7), (9, 12, 7, 4), (5, 9, 7, 4)]),
        (108, 74, [(0, 4), (5, 4), (9, 3), (7, 4)],
         [(7, 4, 2, 0), (5, 9, 12, 9), (4, 7, 9, 7), (2, 7, 11, 9)]),
        (112, 67, [(9, 3), (5, 4), (0, 4), (7, 4)],
         [(9, 12, 16, 12), (9, 5, 7, 9), (7, 4, 0, 4), (7, 11, 14, 11)]),
        (116, 69, [(0, 4), (9, 3), (5, 4), (7, 4)],
         [(4, 7, 12, 7), (9, 7, 4, 2), (5, 7, 9, 12), (11, 7, 2, 7)]),
    ]
    with tempfile.TemporaryDirectory() as tmp:
        for number, spec in enumerate(loops, 1):
            synth_loop(number, *spec, tmp)


def render_reel(post):
    number = post["id"]
    output = SOCIAL / "reels" / f"reel-{number:02}.mp4"
    loop = SOCIAL / "music" / f"loop-{number % 4 + 1}.m4a"
    pending = output.with_suffix(".tmp.mp4")
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "1080x1920",
            "-framerate", str(FPS), "-i", "pipe:0", "-stream_loop", "-1", "-i", str(loop),
            "-map", "0:v:0", "-map", "1:a:0", "-t", str(DURATION),
            "-vf", "fps=24,scale=out_color_matrix=bt709,format=yuv420p",
            "-filter_threads", "2", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast",
            "-crf", "21", "-profile:v", "high", "-level:v", "4.1", "-colorspace", "bt709",
            "-color_primaries", "bt709", "-color_trc", "bt709",
            "-af", "afade=t=in:d=0.08,afade=t=out:st=9.1:d=0.4", "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart", str(pending)]
    try:
        with subprocess.Popen(args, stdin=subprocess.PIPE) as proc:
            try:
                for frame in reel_frames(post):
                    proc.stdin.write(frame)
            finally:
                proc.stdin.close()
            if proc.wait() != 0:
                raise subprocess.CalledProcessError(proc.returncode, args)
        if pending.stat().st_size >= 50_000_000:
            raise ValueError(f"{output.name} exceeds 50 MB")
        pending.replace(output)
    finally:
        pending.unlink(missing_ok=True)
    print(f"{output.name}  loop-{number % 4 + 1}.m4a  {output.stat().st_size:,} bytes", flush=True)


def manifest(posts):
    hooks = {0: "A smarter way to job hunt"}
    return [
        {"id": post["id"],
         "video": f"https://fortunejobsai.com/social/reels/reel-{post['id']:02}.mp4",
         "cover": post["image"],
         "caption": f"{hooks.get(post['id'], post['title'])}\n\n{post['post_caption']}"}
        for post in posts
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ids", nargs="+", type=int, help="Render only these IDs for a preview")
    parser.add_argument("--workers", type=int, default=2, help="Concurrent video encoders")
    args = parser.parse_args()
    data = json.loads((SOCIAL / "posts.json").read_text(encoding="utf-8"))
    posts = data["posts"]
    if [post["id"] for post in posts] != list(range(len(posts))):
        raise ValueError("Post IDs must be sequential and in feed order")
    reels = manifest(posts)
    for post, reel in zip(posts, reels):
        if len(reel["caption"].splitlines()[0].split()) >= 10:
            raise ValueError(f"Reel hook is too long for post {post['id']}")
        if post["id"] >= 22:
            tags = f"{post['tags']} {data['hashtags']}"
            expected = f"{post['caption']}\n\n👉 Free at fortunejobsai.com (link in bio)\n\n{tags}"
            if len(tags.split()) > 20 or post["post_caption"] != expected:
                raise ValueError(f"Invalid post caption or hashtags for post {post['id']}")
    chosen = set(args.ids if args.ids is not None else range(len(posts)))
    if not chosen <= set(range(len(posts))) or args.workers < 1:
        parser.error("IDs must exist in posts.json and workers must be positive")
    for folder in ("reels", "music"):
        (SOCIAL / folder).mkdir(exist_ok=True)
    music()
    selected = [post for post in posts if post["id"] in chosen]
    for post in selected:
        if post["id"] >= 22:
            photo(post)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(render_reel, selected))
    if args.ids is None:
        (SOCIAL / "reels.json").write_text(
            json.dumps(reels, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
