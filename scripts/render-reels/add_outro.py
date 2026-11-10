"""Give every reel the brand ending: content up to the old end card (7.0 s), then the spinning
gold logo with glow, twinkling stars and the coin/twinkle sound (outro.py, original audio).
Run after render.py:  python scripts/render-reels/outro.py && python scripts/render-reels/add_outro.py
Reels that already have the ending (longer than 9.6 s) are skipped, so it is safe to re-run."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
REELS = os.path.join(HERE, '..', '..', 'social', 'reels')
OUTRO = os.path.join(HERE, 'build-outro', 'outro.mp4')
CUT = 7.0

def duration(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]))

for name in sorted(f for f in os.listdir(REELS) if f.endswith('.mp4')):
    src = os.path.join(REELS, name)
    if duration(src) > 9.6:
        continue
    tmp = src + '.tmp.mp4'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-i', OUTRO, '-filter_complex',
        f'[0:v]trim=0:{CUT},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v0];'
        f'[0:a]atrim=0:{CUT},asetpts=PTS-STARTPTS,afade=t=out:st={CUT-0.5}:d=0.5,aformat=sample_rates=44100:channel_layouts=stereo[a0];'
        '[1:v]fps=30,format=yuv420p[v1];[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a1];'
        '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]',
        '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '21', '-preset', 'medium', '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart', tmp], check=True)
    os.replace(tmp, src)
    print(name, round(duration(src), 2), flush=True)
