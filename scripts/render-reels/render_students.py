"""Render the student Reels and append them to both Instagram feeds."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import tempfile
import wave

from PIL import Image, ImageDraw, ImageOps

from render import GOLD, NAVY, SOCIAL, background, brand, fitted, font, kicker, overlay, point

HERE = Path(__file__).resolve().parent
STOCK = [(4560083, .28), (5553049, .32), (6684514, .10), (5538007, .24), (6147047, .32)]
SCRIPTS = {
    52: "Choose three employers and bring one question for each.",
    57: "Describe the feedback, what you changed, and what you learned.",
    62: "Name the club activity you owned and show what changed.",
    67: "Open the exact résumé file you plan to send.",
    72: "Practice the interview with real examples from your experience.",
    77: "Thank the interviewer and mention one detail from your conversation.",
}
FPS = 12
CUT = 7


def layers_for(post):
    number = post["id"]
    dark = number % 2 == 1
    ink = "white" if dark else NAVY
    x, width = 84, 832
    backdrop = background(1920, dark).copy()
    draw = ImageDraw.Draw(backdrop)
    brand(draw, backdrop, x, 165, ink)
    photo, vertical = STOCK[(number - 52) % len(STOCK)]
    with Image.open(HERE / "stock" / f"{photo}.jpg") as source:
        picture = ImageOps.fit(ImageOps.exif_transpose(source).convert("RGB"),
                              (width, 356), centering=(.5, vertical))
    mask = Image.new("L", picture.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, 355), 24, fill=255)
    backdrop.paste(picture, (x, 276), mask)
    draw.rounded_rectangle((x + 18, 579, x + 161, 617), 16, fill=NAVY)
    draw.text((x + 31, 598), "Stock photo", font=font(21, 650), fill="white", anchor="lm")
    kicker(draw, x, 665, post["kicker"])
    face, lines, advance = fitted(draw, post["title"], width, 74, 52, 3, 830)
    y = 755
    for line in lines:
        draw.text((x, y), line, font=face, fill=ink, anchor="lt")
        y += advance
    y += 28
    cards = []
    for text in post["points"]:
        card = overlay(lambda d, _: point(d, x, y, width, text, dark))
        cards.append(card)
        y += card[0].height + 15
    if y > 1450:
        raise ValueError(f"Reel {number} exceeds its content area")
    subtitle = SCRIPTS.get(number)
    if subtitle:
        caption = ImageDraw.Draw(backdrop)
        face, lines, advance = fitted(caption, subtitle, width - 48, 34, 28, 2, 700)
        caption.rounded_rectangle((x, 1468, x + width, 1570), 20, fill=NAVY)
        for i, line in enumerate(lines):
            caption.text((x + width / 2, 1519 + (i - (len(lines) - 1) / 2) * advance),
                         line, font=face, fill="white", anchor="mm")
    return backdrop, cards


def voiceovers(model, directory):
    from piper import PiperVoice, SynthesisConfig

    voice = PiperVoice.load(str(model))
    for number, script in SCRIPTS.items():
        path = directory / f"voice-{number}.wav"
        with wave.open(str(path), "wb") as stream:
            voice.synthesize_wav(script, stream, syn_config=SynthesisConfig(length_scale=.94))
        with wave.open(str(path), "rb") as stream:
            if stream.getnframes() / stream.getframerate() > 5.9:
                raise ValueError(f"Narration for reel {number} does not fit before the outro")


def render(post, directory):
    number = post["id"]
    final = SOCIAL / "reels" / f"reel-{number}.mp4"
    output = directory / final.name
    loop = SOCIAL / "music" / f"loop-{number % 4 + 1}.m4a"
    original_outro = SOCIAL / "reels" / "reel-00.mp4"
    args = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
            "-video_size", "1080x1920", "-framerate", str(FPS), "-i", "pipe:0",
            "-stream_loop", "-1", "-i", str(loop), "-ss", str(CUT), "-i", str(original_outro)]
    soundtrack = "[1:a]atrim=0:7,asetpts=PTS-STARTPTS,volume="
    if number in SCRIPTS:
        args += ["-i", str(directory / f"voice-{number}.wav")]
        soundtrack += ("0.22[m];[3:a]aresample=44100,aformat=channel_layouts=stereo,"
                       "adelay=850:all=1,volume=0.85[n];"
                       "[m][n]amix=inputs=2:duration=first:normalize=0,")
    else:
        soundtrack += "0.78,"
    soundtrack += "afade=t=in:d=0.10,afade=t=out:st=6.55:d=0.45[a0];"
    filters = (
        "[0:v]fps=30,scale=out_color_matrix=bt709,format=yuv420p,setsar=1[v0];"
        "[2:v]fps=30,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v1];"
        + soundtrack +
        "[2:a]asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo[a1];"
        "[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"
    )
    args += ["-filter_complex_threads", "2", "-filter_complex", filters, "-map", "[v]", "-map", "[a]",
             "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "21",
             "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709",
             "-color_trc", "bt709", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(output)]
    image, cards = layers_for(post)
    frame = image.tobytes()
    with subprocess.Popen(args, stdin=subprocess.PIPE) as proc:
        try:
            for n in range(FPS * CUT):
                if n in (10, 24, 38):
                    card, position = cards[(10, 24, 38).index(n)]
                    image.paste(card, position, card)
                    frame = image.tobytes()
                proc.stdin.write(frame)
        finally:
            proc.stdin.close()
        if proc.wait():
            raise subprocess.CalledProcessError(proc.returncode, args)
    if output.stat().st_size >= 50_000_000:
        raise ValueError(f"{final.name} exceeds 50 MB")
    output.replace(final)
    print(f"{final.name} rendered", flush=True)


def append_feeds(posts):
    reels_path = SOCIAL / "reels.json"
    feed_path = SOCIAL / "reels-feed.json"
    reels = json.loads(reels_path.read_text(encoding="utf-8"))
    feed = json.loads(feed_path.read_text(encoding="utf-8"))
    for entries in (reels, feed["posts"]):
        if [p["id"] for p in entries] not in (list(range(52)), list(range(82))):
            raise ValueError("Expected ordered Reel IDs 0–51 or 0–81")
    additions = []
    for post in posts:
        number = post["id"]
        hook = post["title"]
        if len(hook.split()) >= 10 or len(post["post_caption"].splitlines()[-1].split()) != 5:
            raise ValueError(f"Invalid hook or hashtag count for Reel {number}")
        additions.append({"id": number, "video": f"https://fortunejobsai.com/social/reels/reel-{number}.mp4",
                          "cover": post["image"], "caption": f"{hook}\n\n{post['post_caption']}"})
    reels = reels[:52] + additions
    feed["posts"] = feed["posts"][:52] + [
        {"id": p["id"], "image": p["video"], "cover": p["cover"], "post_caption": p["caption"]}
        for p in additions
    ]
    for path, value in ((reels_path, reels), (feed_path, feed)):
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice-model", type=Path, required=True)
    parser.add_argument("--ids", nargs="+", type=int, help="Preview these new IDs without updating feeds")
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()
    data = json.loads((SOCIAL / "posts.json").read_text(encoding="utf-8"))
    posts = data["posts"][52:82]
    if [p["id"] for p in posts] != list(range(52, 82)):
        raise ValueError("Expected photo IDs 52–81")
    ids = set(args.ids or range(52, 82))
    if not ids <= set(range(52, 82)) or args.workers < 1:
        parser.error("Use new IDs 52–81 and a positive worker count")
    with tempfile.TemporaryDirectory(dir=SOCIAL) as folder:
        directory = Path(folder)
        if ids & SCRIPTS.keys():
            voiceovers(args.voice_model, directory)
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            list(pool.map(lambda post: render(post, directory),
                          (post for post in posts if post["id"] in ids)))
    if args.ids is None:
        append_feeds(posts)


if __name__ == "__main__":
    main()
