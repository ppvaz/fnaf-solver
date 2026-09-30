#!/usr/bin/env python3
"""Cut a FNaF 1 4/20 run's video into something to show: a README GIF and a
phone-sized video.

  fnaf1-teach-media.py --run artifacts/runs/<id> --video FILE.mp4 --out DIR

The run's own records place everything. The office's first frame is found in
the video (the what_day card is black; the office is not), which puts the
night's origin on the video's clock; the policy log then names a Bonnie
visit -- a left check that shut the door and the reopen after his tick -- and
that window becomes the GIF, the full frame on top and the teach panel
enlarged 2x underneath, like the FNaF 2 cycle GIF in the README.

Outputs (never tracked unless a person chooses to): <out>/fnaf1-420-bonnie-visit.gif,
<out>/fnaf1-420-whatsapp-4x.mp4 (the whole night at 4x) and
<out>/fnaf1-420-whatsapp-highlights.mp4 (the visit and the 5 AM -> 6 AM end in
real time).
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

# The Companion's FNaF 1 panel, native pixels (Fnaf1Lesson.java).
PANEL = (560, 110, 1340, 330)


def run(cmd):
    subprocess.run(cmd, check=True)


def probe_size(video):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height", "-of", "csv=p=0", str(video)],
                         check=True, capture_output=True, text=True).stdout.strip()
    w, h = (int(v) for v in out.split(","))
    return w, h


def office_onset(video, limit_s=25.0):
    """Seconds into the video of the first bright office frame after the card."""
    w, h = 96, 44
    raw = subprocess.run(["ffmpeg", "-v", "error", "-t", str(limit_s), "-i", str(video), "-vf",
                          f"fps=20,scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                         check=True, capture_output=True).stdout
    size = w * h
    means = [sum(raw[i:i + size]) / size for i in range(0, len(raw) - size + 1, size)]
    # The card and the load are near black; the office's first frame jumps.
    for i in range(1, len(means)):
        if means[i] > 18 and means[i - 1] < 12 and i / 20.0 > 2.0:
            return i / 20.0
    raise SystemExit("fnaf1-teach-media: no office onset found in the first %.0f s" % limit_s)


def bonnie_visit(events):
    """(start, end) night seconds of the first left check that shut the door, to its reopen."""
    logs = []
    for e in events:
        if e.get("type") == "policy":
            m = e["m"]
            t = float(m.split()[0])
            logs.append((t, m))
    for i, (t, m) in enumerate(logs):
        if " run check-left@" not in m:
            continue
        rest = logs[i + 1:i + 40]
        shut = next((u for u, n in rest if "close-left" in n and u - t < 6), None)
        if shut is None:
            continue
        reopen = next((u for u, n in logs[i + 1:] if "reopen-left@" in n and u > shut), None)
        if reopen is not None and 40 < t < 500:
            return t - 1.0, reopen + 2.5
    raise SystemExit("fnaf1-teach-media: no Bonnie visit in the policy log")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", choices=("gif", "all"), default="all",
                    help="gif: the README GIF alone (a run that did not reach 6 AM has no end to cut)")
    args = ap.parse_args()
    run_dir = Path(args.run)
    video = Path(args.video)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    events = [json.loads(line) for line in (run_dir / "events.jsonl").read_text().splitlines()]
    probe = json.loads((run_dir / "probe.json").read_text())
    offset_ms = probe["night"]["originOffsetMs"]
    w, h = probe_size(video)
    scale = w / 2400.0
    onset = office_onset(video)
    origin = onset + offset_ms / 1000.0          # night 0 on the video's clock
    start, end = bonnie_visit(events)
    print(json.dumps({"video": str(video), "size": [w, h], "officeOnsetS": onset,
                      "visitNightS": [round(start, 2), round(end, 2)]}))

    x0, y0, x1, y1 = (round(v * scale) for v in PANEL)
    pw, ph = x1 - x0, y1 - y0
    gif = out / "fnaf1-420-bonnie-visit.gif"
    vf = (f"[0:v]split=2[a][b];[a]scale=960:-2[top];"
          f"[b]crop={pw}:{ph}:{x0}:{y0},scale=960:-2:flags=neighbor[panel];"
          f"[top][panel]vstack,fps=8,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4")
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{origin + start:.2f}", "-t", f"{end - start:.2f}",
         "-i", str(video), "-filter_complex", vf, str(gif)])

    if args.only == "gif":
        print(f"{gif} {gif.stat().st_size / 1e6:.1f} MB")
        return 0
    full = out / "fnaf1-420-whatsapp-4x.mp4"
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0, origin - 2):.2f}", "-t", "560", "-i", str(video),
         "-vf", "setpts=PTS/4,fps=30,scale=1200:-2", "-an", "-c:v", "libx264", "-preset", "slow",
         "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(full)])

    hl = out / "fnaf1-420-whatsapp-highlights.mp4"
    parts = [(origin - 1, 20), (origin + start, end - start), (origin + 520, 25)]
    filters = "".join(f"[0:v]trim=start={a:.2f}:duration={d:.2f},setpts=PTS-STARTPTS,scale=1200:-2[v{i}];"
                      for i, (a, d) in enumerate(parts))
    filters += "".join(f"[v{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=1:a=0[v]"
    run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-filter_complex", filters, "-map", "[v]",
         "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", str(hl)])
    for f in (gif, full, hl):
        print(f"{f} {f.stat().st_size / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
