#!/usr/bin/env python3
"""What killed us, across every night we have on disk.

grade-run.sh answers "what happened in THIS run". Nothing answered "what keeps
happening", and that turned out to be the question worth asking: pulling the
death frame out of all 33 recordings and tiling them put the answer on one
screen in a way no per-run report had.

    Withered Foxy   19
    Puppet           3
    Golden Freddy    2
    no jumpscare     9   (aborted on cams, or masked at the end)

BUT READ THE TIMES, NOT JUST THE FACES. The obvious reading of "Foxy killed 79%
of them" is the documented BB->Foxy chain -- BB reaches the office, g96 takes
every light, the hall cannot be flashed, Foxy's D runs out. That reading is
wrong here, and the alive column is what refutes it: those deaths cluster at
about 30 s, and ON-DEVICE-VALIDATION.md puts Balloon Boy's earliest possible
arrival at the left OPENING at 25 s, with at least another five-second roll
needed to get inside. He cannot have taken the lights yet. Foxy is killing on
his own, early, because the hall flash never reached him -- which is what a
monitor desync does: with the cams up, the hall press lands on the camera map.
The device owner saw exactly that before any log did ("haven't seen any hall
light", "started panning view instead of flashing").

The one death where the chain IS the story is night 6-34, the longest run at
120 s: Foxy's face and Balloon Boy's balloon in the same frame.

So this exists to keep the distinction visible. A census of faces alone would
have shipped the wrong cause; the faces and the clock together give the right
one.

Usage: death-census.py OUT_DIR
"""
import os, subprocess, sys, re
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, str(Path(__file__).resolve().parent / "../../packages/play/src/sensors/screencap"))  # Play's screencap readers
import nightpredicate  # noqa: E402
W,H = 1280,576
def decode(p,fps,w,h,pix,d):
    o=subprocess.run(["ffmpeg","-v","error","-i",str(p),"-vf",f"fps={fps},scale={w}:{h}",
                      "-f","rawvideo","-pix_fmt",pix,"-"],capture_output=True)
    s=w*h*d
    return [o.stdout[i:i+s] for i in range(0,len(o.stdout)-s+1,s)]
def cmean(f,box,step=3):
    x0,y0,x1,y1=box; t=[0,0,0]; c=0
    for y in range(y0,y1,step):
        r=y*W
        for x in range(x0,x1,step):
            i=(r+x)*3; t[0]+=f[i]; t[1]+=f[i+1]; t[2]+=f[i+2]; c+=1
    return [v/max(c,1) for v in t]
def night(f):
    """The shared predicate, evaluated at this file's video geometry.

    This was one of the hand copies of the alive/dead rule, ported 2026-08-26.
    It still tested the meter and mask boxes directly, with no global
    brightness guard, after nightpredicate.py had gained one -- so it counted
    the "HELP WANTED" newspaper -- the cutscene a New Game plays -- as a
    running night. Harmless while the corpus was all n6-night-* mask-camp
    recordings, which never show it; wrong the moment a census reads a
    fresh-save run. One rule, sampled here rather than restated."""
    def sample(fx0, fy0, fx1, fy1):
        return cmean(f, (max(0, int(fx0 * W)), max(0, int(fy0 * H)),
                         min(W, max(int(fx1 * W), int(fx0 * W) + 1)),
                         min(H, max(int(fy1 * H), int(fy0 * H) + 1))))
    return nightpredicate.is_night(sample)

def main():
    """The census itself. Guarded so the predicate above can be imported.

    test-screenstate.py asserts all three callers of nightpredicate.py answer
    alike; it cannot do that against a module that globs `captures/` and reads
    `sys.argv[1]` at import time."""
    out=[]
    vids=sorted(Path("captures").glob("n6-night-*.mp4"), key=lambda p:int(re.search(r'night-(\d+)',p.name).group(1)))
    for v in vids:
        if "keyframes" in v.name: continue
        fr=decode(v,2,W,H,"rgb24",3)
        if not fr: continue
        fl=[night(f) for f in fr]
        # last frame of the FIRST alive run
        # The HUD legitimately disappears for ~300 ms on every monitor flip, so the
        # end needs the same settle the start does. Breaking on the first absent
        # frame reported a flip as a death and put night 6-34 at 30 s against its
        # graded 120.5 s.
        start=None; end=None; s=0; miss=0
        for i,x in enumerate(fl):
            s=s+1 if x else 0
            if s>=3 and start is None: start=i-2
            if start is not None:
                miss=0 if x else miss+1
                if miss>=4:
                    end=i-3; break
        if start is None: continue
        idx=max(start,(end-1) if end else len(fl)-1)
        n=re.search(r'night-(\d+)',v.name).group(1)
        out.append((n,(end/2 if end else len(fl)/2)-start/2,idx,fr[idx]))
    print(f"{len(out)} nights with a death frame")

    # The number that matters is not the face, it is the clock.
    #
    # ON-DEVICE-VALIDATION.md measured what an unflashed Foxy costs, before any of
    # this pilot existed: "Three closed-loop 6th Night mask-camp trials died at
    # 29/31/31 s to the W. Foxy office lunge ... the mask does not deter him, his D
    # grows unflashed." So ~30 s is not a coincidence and not a distribution -- it
    # is the constant for "Foxy was never flashed".
    #
    # It also rules out the reading the faces invite. The BB->Foxy chain needs BB in
    # the office taking the lights, and he cannot reach the left opening before 25 s
    # with at least another roll to get inside. A 30 s death is Foxy killing on his
    # own, from the very start, because the hall flash never reached him.
    UNFLASHED_LO, UNFLASHED_HI = 28.0, 32.0
    BB_INSIDE_S = 30.0
    times = sorted(a for _, a, _, _ in out)
    unflashed = [(n, a) for n, a, _, _ in out if UNFLASHED_LO <= a <= UNFLASHED_HI]
    print(f"alive: median {times[len(times)//2]:.0f}s  min {times[0]:.0f}s  max {times[-1]:.0f}s")
    print(f"in the measured unflashed-Foxy window ({UNFLASHED_LO:.0f}-{UNFLASHED_HI:.0f}s): "
          f"{len(unflashed)}/{len(out)}")
    print("  " + " ".join(f"n{n}:{a:.0f}s" for n, a in unflashed))
    late = [(n, a) for n, a, _, _ in out if a > UNFLASHED_HI]
    print(f"outlived it: {len(late)}/{len(out)}")
    print("  " + " ".join(f"n{n}:{a:.0f}s" for n, a in late))
    print("A Foxy face inside that window is Foxy killing unflashed, not the")
    print("BB chain. With the cams desynced up, the hall press lands on the map.")
    from PIL import Image, ImageDraw
    per=12
    for pg in range((len(out)+per-1)//per):
        chunk=out[pg*per:(pg+1)*per]
        tw,th=426,192; cols=3
        rows=(len(chunk)+cols-1)//cols
        sh=Image.new("RGB",(tw*cols,th*rows),(10,10,10)); d=ImageDraw.Draw(sh)
        for i,(n,alive,idx,f) in enumerate(chunk):
            im=Image.frombytes("RGB",(W,H),f).point(lambda v:min(255,int(v*2.0))).resize((tw,th))
            x,y=(i%cols)*tw,(i//cols)*th
            sh.paste(im,(x,y))
            lab=f"n{n}  alive {alive:.0f}s"
            d.rectangle([x+2,y+2,x+2+7*len(lab),y+13],fill=(0,0,0))
            d.text((x+4,y+3),lab,fill=(255,220,90))
        sh.save(f"{sys.argv[1]}/deaths-{pg+1}.png")
        print(f"  page {pg+1}: {' '.join(n for n,_,_,_ in chunk)}")


if __name__ == "__main__":
    main()
