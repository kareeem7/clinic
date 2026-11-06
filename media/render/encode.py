import subprocess, sys, time
sys.path.insert(0, "/tmp/vid")
import render as R

FPS = 30
DUR = 31.67
N = int(round(DUR * FPS))
OUT = "/tmp/vid/clinic_demo.mp4"

cmd = ["/tmp/ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
       "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1280x720", "-r", str(FPS), "-i", "-",
       "-i", "/tmp/vid/voice_pad.mp3",
       "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
       "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", OUT]
p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
t0 = time.time()
for i in range(N):
    f = R.frame_at(i / FPS).convert("RGB")
    p.stdin.write(f.tobytes())
    if i % 60 == 0:
        print(f"{i}/{N} {time.time()-t0:.1f}s", flush=True)
p.stdin.close()
p.wait()
print("exit", p.returncode, "elapsed", round(time.time()-t0, 1))
