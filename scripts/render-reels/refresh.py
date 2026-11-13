"""Build scheduled photo art and edited product demos from captured public footage."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageOps

from render import GOLD, NAVY, SOCIAL, background, fitted, logo

FORMATS = ("Product demo", "Job of the day", "Résumé myth / fact",
           "Catalogue snapshot", "3-step checklist", "Student Q&A")
SHOTS = ("search", "ats", "tracker", "hiring", "save")
SHOT_LABELS = {"search": "Find jobs", "ats": "Free ATS résumé check",
               "tracker": "Application tracker · Demo account",
               "hiring": "Hiring now", "save": "Saved jobs · Demo account"}
SHOT_COPY = {
    "search": ("Search a role in seconds", ["Enter a role or skill", "Choose a location", "Review the results"], "Start with a role or skill and a location. Open a result to review the job details and application steps."),
    "ats": ("Check your résumé", ["Upload a text-based PDF or DOCX", "Review the ATS score", "Use the feedback to revise"], "Use the free ATS résumé check to spot formatting and content issues. The screen shows a sample résumé."),
    "tracker": ("See where you left off", ["Save a listing", "Update its stage in your profile", "Add a private note"], "Keep your next steps in Saved Jobs. The screen uses a demo account."),
    "hiring": ("See who's hiring", ["Browse employer names", "Check the open-job counts", "Open a company search"], "Explore companies with open listings in the catalogue. Counts change, and listings do not imply an affiliation."),
    "save": ("Save a role for later", ["Open the listing", "Select Save job", "Find it in your profile"], "Save roles you want to revisit. The screen uses a demo account."),
}
MYTHS = ("A résumé needs a graphic-heavy layout.", "Every résumé needs an objective.",
         "One résumé works for every role.", "Only paid experience belongs on a résumé.",
         "Recruiters need every course you took.", "A project title tells the whole story.",
         "A score tells you whether you’ll be hired.", "A PDF is always readable by software.",
         "A longer résumé always looks stronger.", "Every bullet needs a number.",
         "A résumé needs a full street address.", "A skill list is enough on its own.")


def words(draw, text, x, y, width, maximum, lines, color=NAVY, weight=700):
    face, wrapped, lead = fitted(draw, text, width, maximum, 20, lines, weight)
    for line in wrapped:
        draw.text((x, y), line, font=face, fill=color, anchor="lt")
        y += lead
    return y


def render_post(post, captures, data):
    index = post["id"]
    kind = (index - 9) % 6
    if index == 16:
        kind = 4
    elif index == 19:
        kind = 1
    turn = (index - 9) // 6
    title, points, caption = post["title"], post["points"], post["caption"]
    dark = kind in (0, 3)
    paper = background(1350, dark).copy() if kind in (0, 3, 5) else Image.new("RGB", (1080, 1350), "#fffaf0")
    draw = ImageDraw.Draw(paper)
    ink = "#ffffff" if dark else NAVY
    paper.paste(logo(62), (68, 61), logo(62))
    words(draw, "FORTUNE JOBS AI", 151, 78, 790, 30, 1, ink)
    words(draw, FORMATS[kind].upper(), 72, 180, 930, 26, 1, "#f3d781" if dark else "#76500b")
    if kind == 0:
        shot = SHOTS[turn % len(SHOTS)]
        title, points, caption = SHOT_COPY[shot]
        words(draw, title, 72, 282, 425, 76, 5, ink)
        words(draw, SHOT_LABELS[shot], 74, 743, 410, 34, 3, "#f3d781")
        screenshot = Image.open(captures / (shot + ".png")).convert("RGB")
        phone = ImageOps.contain(screenshot, (500, 885), Image.Resampling.LANCZOS)
        px, py = 526, 242
        draw.rounded_rectangle((px-14, py-14, px+phone.width+14, py+phone.height+14), radius=36, fill="#031120", outline=GOLD, width=4)
        paper.paste(phone, (px, py))
    elif kind == 1:
        pick = data["picks"][turn]
        words(draw, pick["job_title"], 72, 280, 935, 100, 4)
        words(draw, pick["company"] + " · " + pick["location"], 72, 777, 920, 45, 3)
        words(draw, "Open in our catalogue on " + data["date"] + ". Search the title to check availability.", 72, 968, 910, 34, 3)
        title = "Job of the day: " + pick["job_title"]
        points = [pick["company"], pick["location"], "Check current availability"]
        caption = f'{pick["job_title"]} at {pick["company"]} in {pick["location"]} appeared in our catalogue on {data["date"]}. Search the title to check if it’s still open.'
    elif kind == 2:
        myth = MYTHS[turn]
        draw.rounded_rectangle((62, 256, 1018, 655), radius=36, fill=NAVY)
        words(draw, "MYTH", 105, 304, 870, 31, 1, GOLD)
        words(draw, myth, 105, 394, 860, 71, 3, "#ffffff")
        words(draw, "FACT", 103, 716, 870, 31, 1, "#76500b")
        facts = (
            "A clear, single-column layout makes the important details easier to find.",
            "Use a short summary only when it adds relevant context.",
            "Tailor the examples and skills you highlight for each kind of role.",
            "Relevant class projects and volunteer work can show what you did.",
            "Include coursework when it helps explain a skill the job needs.",
            "Add your contribution, the tools you used and the result.",
            "A score is a review aid. Employers make their own decisions.",
            "Export a text-based PDF and check that you can select the text.",
            "Keep the experience that makes your case for this role.",
            "Specific scope and outcomes can show impact even without a number.",
            "City, region and reliable contact details are enough for most résumés.",
            "Connect each important skill to something you did with it.",
        )
        fact = facts[turn]
        words(draw, fact, 103, 806, 870, 59, 4)
        title, points, caption = "Résumé myth vs. fact", [myth, fact], f"Résumé myth: {myth} {fact}"
    elif kind == 3:
        stat = data["stats"][turn]
        count = f'{stat["count"]:,}'
        words(draw, count, 65, 261, 950, 265, 1, GOLD, 800)
        headline = f'{stat["title"]} jobs in {stat["place"]}'
        words(draw, headline, 74, 598, 930, 84, 3, ink)
        words(draw, "Open listings in our catalogue on " + data["date"] + ".", 74, 970, 920, 35, 2, ink)
        title, points = count + " " + headline, ["Open catalogue listings", "Snapshot on " + data["date"]]
        caption = f"{title} were open in our catalogue on {data['date']}. Counts change as jobs open and close."
    elif kind == 4:
        words(draw, title, 74, 242, 930, 72, 3)
        for i, point in enumerate(points[:3]):
            y = 550 + i * 195
            draw.rounded_rectangle((70, y, 1010, y + 166), radius=26, fill=(NAVY if i == 0 else "#f1e2b8"))
            words(draw, str(i + 1), 104, y + 41, 75, 70, 1, GOLD if i == 0 else NAVY)
            words(draw, point, 219, y + 38, 745, 49, 2, "#ffffff" if i == 0 else NAVY)
    else:
        stock = sorted(Path(__file__).with_name("stock").glob("*.jpg"))
        portrait = ImageOps.fit(Image.open(stock[turn % len(stock)]).convert("RGB"), (940, 415))
        paper.paste(portrait, (70, 242))
        draw.rounded_rectangle((84, 602, 236, 644), radius=12, fill=NAVY)
        words(draw, "Stock photo", 101, 611, 135, 22, 1, "#ffffff")
        question = title.rstrip("?.!") + "?"
        words(draw, question, 70, 693, 935, 66, 3)
        guidance = " · ".join(points[:3])
        words(draw, guidance, 73, 948, 920, 37, 4)
    draw.line((70, 1200, 1010, 1200), fill=GOLD, width=3)
    words(draw, "fortunejobsai.com", 72, 1244, 930, 34, 1, ink)
    paper.save(SOCIAL / f"post-{index:02}.jpg", quality=90, optimize=True)
    if kind in (0, 1, 2, 3):
        original = post["post_caption"]
        footer = original.split("\n\n", 1)[1]
        post.update(title=title, points=points, caption=caption, post_caption=caption + "\n\n" + footer)


DEMO_EDITS = [
    ("Find your next role", [("search", 1.0), ("search", 3.9), ("hiring", 2.8)]),
    ("Check your résumé", [("ats", 0.65), ("ats", 1.65), ("search", 3.9)]),
    ("Track your next step", [("save", 2.85), ("tracker", 0.30), ("tracker", 0.45)]),
    ("See who's hiring", [("hiring", 1.6), ("hiring", 2.8), ("search", 3.9)]),
    ("Save a role for later", [("search", 3.9), ("save", 2.85), ("tracker", 0.35)]),
]


def ffmpeg(args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-filter_complex_threads", "1", *map(str, args)], check=True)


def build_edits(captures, output):
    clips = {}
    for name, slices in DEMO_EDITS:
        for shot, start in slices:
            for first in (False, True):
                title = name if first else SHOT_LABELS[shot].split(" · ")[0]
                key = shot, start, title
                if key in clips:
                    continue
                overlay = Image.new("RGBA", (1080, 1920))
                draw = ImageDraw.Draw(overlay)
                draw.rectangle((0, 0, 1080, 243), fill=NAVY)
                draw.rectangle((0, 240, 1080, 246), fill=GOLD)
                overlay.paste(logo(57), (71, 64), logo(57))
                words(draw, title, 153, 57, 850, 65, 2, "#ffffff")
                words(draw, "DEMO ACCOUNT" if shot in ("tracker", "save") else "FORTUNE JOBS AI",
                      155, 155, 850, 30, 1, GOLD)
                draw.rectangle((0, 1670, 1080, 1920), fill=NAVY)
                words(draw, "fortunejobsai.com", 70, 1740, 900, 46, 1, GOLD)
                tile = output / f"clip-{len(clips)}.png"
                clip = tile.with_suffix(".mp4")
                overlay.save(tile)
                ffmpeg(["-ss", start, "-i", captures / (shot + ".webm"), "-i", tile,
                        "-filter_complex", "[0:v]fps=30,scale=810:1440,pad=1080:1920:135:245:color=0x10243b,tpad=stop_mode=clone:stop_duration=1[screen];[screen][1:v]overlay,format=yuv420p",
                        "-t", "1.45", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", clip])
                clips[key] = clip

    outro = output / "original-outro.mp4"
    ffmpeg(["-sseof", "-3.2", "-i", SOCIAL / "reels" / "reel-00.mp4", "-t", "3.2", "-c:v", "libx264",
            "-preset", "fast", "-crf", "21", "-c:a", "aac", outro])
    variants = []
    for index, (hook, slices) in enumerate(DEMO_EDITS):
        joined = output / f"join-{index}.txt"
        paths = [clips[shot, start, hook if i == 0 else SHOT_LABELS[shot].split(" · ")[0]]
                 for i, (shot, start) in enumerate(slices)]
        joined.write_text("".join(f"file '{clip.name}'\n" for clip in paths), encoding="utf-8")
        variants.append(joined)
    return variants, outro


def render_reels(captures, start, end):
    variants, outro = build_edits(captures, captures)
    reels_file = SOCIAL / "reels.json"
    feed_file = SOCIAL / "reels-feed.json"
    reels = json.loads(reels_file.read_text(encoding="utf-8"))
    feed = json.loads(feed_file.read_text(encoding="utf-8"))

    def one(index):
        variant = (index - start) % len(DEMO_EDITS)
        hook = DEMO_EDITS[variant][0]
        alternate = ("Watch a job search in action.", "See a sample résumé checked in the browser.",
                     "See how to move a saved job through your application stages.",
                     "Explore the Hiring now strip and run a search.",
                     "Save a listing and revisit it in your tracker.")[variant]
        if variant in (2, 4):
            alternate += " Account activity shown is a demo."
        tags = reels[index]["caption"].rsplit("\n\n", 1)[-1]
        caption = f"{hook}\n\n{alternate}\n\nFree at fortunejobsai.com (link in bio)\n\n{tags}"
        dest = SOCIAL / "reels" / f"reel-{index:02}.mp4"
        ffmpeg(["-f", "concat", "-safe", "0", "-i", variants[variant], "-stream_loop", "-1", "-i",
                SOCIAL / "music" / f"loop-{index % 4 + 1}.m4a", "-i", outro, "-filter_complex",
                "[0:v]trim=duration=4.3,setpts=PTS-STARTPTS,fps=30[v0];[1:a]atrim=duration=4.3,asetpts=PTS-STARTPTS,volume=0.5,afade=t=out:st=3.9:d=0.4,aformat=sample_rates=44100:channel_layouts=stereo[a0];[2:v]fps=30[v1];[2:a]aformat=sample_rates=44100:channel_layouts=stereo[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]",
                "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "24",
                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dest])
        return index, caption

    with ThreadPoolExecutor(max_workers=2) as pool:
        for index, caption in pool.map(one, range(start, end + 1)):
            reels[index]["caption"] = caption
            feed["posts"][index]["post_caption"] = caption
    reels_file.write_text(json.dumps(reels, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    feed_file.write_text(json.dumps(feed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("captures", type=Path)
    parser.add_argument("--reels", action="store_true")
    args = parser.parse_args()
    if args.reels:
        render_reels(args.captures.resolve(), 9, 81)
    else:
        path = SOCIAL / "posts.json"
        manifest = json.loads(path.read_text(encoding="utf-8"))
        data = json.loads((args.captures / "catalogue.json").read_text(encoding="utf-8"))
        for post in manifest["posts"][9:]:
            render_post(post, args.captures, data)
        path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
