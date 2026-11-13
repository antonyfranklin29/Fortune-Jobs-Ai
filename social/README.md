# Fortune Jobs AI Instagram library

`posts.json` and `post-NN.jpg` provide 52 photos in feed order. IDs 00–21 are the original photos. IDs 22–51 are additions. `reels.json` provides a video, photo cover and hook-prefixed caption for each of the 52 IDs.

| Make.com feed | Schedule (America/New_York) | Fields |
|---|---|---|
| Photos | Daily at 11 AM | `posts.json` → `posts[].image`, `posts[].post_caption` |
| Reels | Mon, Wed, Fri and Sun at 7 PM | `reels.json` → `[].video`, `[].cover`, `[].caption` |

Claude owns the Make.com scenarios and connects the reel feed after Franklin approves publication. Consume both feeds in ID order. The photo manifest's original `_about` text describes a previous rotation interval. Use the schedule above for the handoff.

## Rebuild the assets

From the repository root with Python 3.10+, Pillow, NumPy, and FFmpeg with libx264 and AAC on PATH:

```sh
python -m pip install Pillow numpy
python scripts/render-reels/render.py
```

The script renders photos starting at ID 22, the four audio loops, the reels, and `reels.json`. It reads the brand mark from `favicon.svg` and uses the bundled Inter font with its Open Font License. For a subset preview, run `python scripts/render-reels/render.py --ids 0 22 49`. Subset runs regenerate the same four loops and leave the reel manifest alone. Use `--workers 1` to reduce CPU use.

Reels are 1080×1920, 10.2 seconds, 30 fps, H.264/AAC, with the MP4 header at the front for playback over HTTP. The original ID 00 flyer has six reasons, so its reel uses reasons 1, 2 and 5. Its photo and full post caption remain the original cover and caption body.

Each music loop is composed in the renderer from synthesized instruments and percussion. The four tempos are 104, 108, 112, and 116 BPM. Assign loop `(id % 4) + 1`.

| Loop | Reel IDs |
|---|---|
| `loop-1.m4a` | 00, 04, 08, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48 |
| `loop-2.m4a` | 01, 05, 09, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49 |
| `loop-3.m4a` | 02, 06, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50 |
| `loop-4.m4a` | 03, 07, 11, 15, 19, 23, 27, 31, 35, 39, 43, 47, 51 |

## Brand ending and hashtags

Every reel ends with the brand outro (3.2 s): the gold logo spins like a coin, settles with a golden
glow and light sweep, stars twinkle, then the name and URL fade in, with a coin "ching" and twinkle chime.
The sound is synthesized in `scripts/render-reels/outro.py` (original, no licensed audio). After
`render.py`, run `python scripts/render-reels/outro.py && python scripts/render-reels/add_outro.py`;
it cuts each reel at 7.0 s (before the old end card) and appends the outro. Re-running skips reels that
already have it.

Instagram allows at most 5 hashtags per post, so every `post_caption` and reel caption ends with exactly
5: topic tags first, then audience/broad ones (#jobsearch, #careeradvice, #hiring). Put search words in
the caption text too; Instagram search reads it.

## November 13 content refresh

Upcoming slots 09–81 rotate through six designs: product screenshots in a phone frame, a live job pick, résumé myth and fact, a dated catalogue count, a three-card checklist, and student Q&A with licensed stock photography. Slots 16 and 19 trade formats so slot 16 keeps its corrected tech-search copy. The actual images and captions keep the same IDs and paths. Job picks and counts are snapshots, with the date visible on the artwork. Stock photos are illustrative and credit is recorded in the stock README.

The upcoming Reels rotate five cuts of actual site recordings. A hook appears immediately, the footage cuts about every 1.45 seconds, the original music loops rotate by ID, and the last 3.2 seconds are the existing coin-spin outro from Reel 00. The résumé is fictional and the tracker and save scenes use a labelled demo account with intercepted writes. Reels 00–08 and their captions stay as historical schedule slots.

From the repository root, with Chrome, Python Playwright, Pillow, NumPy, and FFmpeg installed, run:

```sh
python -m playwright install ffmpeg
python scripts/render-reels/capture_refresh.py ../social-captures
node scripts/render-reels/refresh_catalogue.mjs ../social-captures/catalogue.json
python scripts/render-reels/refresh.py ../social-captures
python scripts/render-reels/refresh.py ../social-captures --reels
```

Keep the capture folder outside the repository. After rendering, verify that both schedules still have 82 entries and that the Reels feed mirrors the video URLs, covers and captions in `reels.json`.

## Reels scenario feed

`reels-feed.json` repeats `reels.json` in the shape of `posts.json` (`posts[].image` = reel MP4 URL,
`posts[].post_caption` = reel caption, plus `cover`) so the Make.com Reels scenario reuses the photo
scenario's JSON structure. Regenerate it whenever `reels.json` changes. The Reels scenario runs every day at 18:00 America/Chicago (7 PM ET) and posts reel
`floor((now − 1794376800) / 86400) mod 52` (reel 0 on Wed Nov 11, 2026, then one a day).

The photo scenario runs twice a day, 11:00 and 19:30 America/Chicago (12 PM and 8:30 PM ET), and posts
`(floor((now − 1794151800) / 86400) × 2 + (hour ≥ 15 ? 1 : 0) − 3) mod 52` from posts.json.
