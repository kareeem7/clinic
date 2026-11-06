"""موسيقى خلفية متولّدة بالكود (مفيش ملفات موسيقى في البيئة، فبنعملها بنفسنا).
128 BPM · A minor · كيك + سنير + هاي هات + بيس + أربيجيو، مع riser في الآخر.
"""
import numpy as np
import wave

SR = 44100
BPM = 128.0
BEAT = 60.0 / BPM
BAR = BEAT * 4
DUR = 42.6
N = int(SR * DUR)

def t_axis(n):
    return np.arange(n) / SR

def env_exp(n, decay):
    return np.exp(-t_axis(n) * decay)

def kick(dur=0.30):
    n = int(SR * dur); t = t_axis(n)
    f = 118 * np.exp(-t * 26) + 46
    ph = 2 * np.pi * np.cumsum(f) / SR
    a = np.sin(ph) * np.exp(-t * 6.5)
    click = np.random.RandomState(1).randn(n) * np.exp(-t * 400) * 0.18
    return (a + click).astype(np.float32)

def snare(dur=0.22):
    n = int(SR * dur); t = t_axis(n)
    rng = np.random.RandomState(2)
    nz = rng.randn(n)
    nz = np.diff(np.concatenate([[0], nz]))          # highpass تقريبي
    nz = nz / (np.abs(nz).max() + 1e-9)
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 30) * 0.5
    return (nz * np.exp(-t * 24) * 0.9 + body).astype(np.float32)

def hat(dur=0.07):
    n = int(SR * dur); t = t_axis(n)
    rng = np.random.RandomState(3)
    nz = np.diff(np.concatenate([[0], rng.randn(n)]))
    nz = np.diff(np.concatenate([[0], nz]))           # أعلى ترددًا
    nz = nz / (np.abs(nz).max() + 1e-9)
    return (nz * np.exp(-t * 55)).astype(np.float32)

def bass_note(freq, dur):
    n = int(SR * dur); t = t_axis(n)
    saw = np.zeros(n, dtype=np.float32)
    for h in range(1, 9):
        saw += (np.sin(2 * np.pi * freq * h * t) / h).astype(np.float32)
    # lowpass بسيط (one-pole)
    a = 0.22
    out = np.empty_like(saw); acc = 0.0
    for i in range(n):
        acc += a * (saw[i] - acc); out[i] = acc
    e = np.minimum(1.0, t / 0.006) * np.exp(-t * 3.2)
    return (out * e * 0.9).astype(np.float32)

def pluck(freq, dur):
    n = int(SR * dur); t = t_axis(n)
    w = np.zeros(n, dtype=np.float32)
    for h, amp in ((1, 1.0), (2, 0.42), (3, 0.26), (5, 0.14)):
        w += (np.sin(2 * np.pi * freq * h * t) * amp).astype(np.float32)
    e = np.minimum(1.0, t / 0.004) * np.exp(-t * 13)
    return (w * e * 0.24).astype(np.float32)

def riser(dur):
    n = int(SR * dur); t = t_axis(n)
    rng = np.random.RandomState(5)
    nz = rng.randn(n)
    nz = np.diff(np.concatenate([[0], nz]))
    nz = nz / (np.abs(nz).max() + 1e-9)
    sweep = np.sin(2 * np.pi * np.cumsum(np.linspace(300, 1800, n)) / SR) * 0.25
    amp = (t / dur) ** 2
    return ((nz * 0.6 + sweep) * amp).astype(np.float32)

def add(buf, sig, at):
    i = int(at * SR)
    if i < 0 or i >= len(buf):
        return
    end = min(len(buf), i + len(sig))
    buf[i:end] += sig[:end - i]

# A minor: Am F C G، والـ arp بياخد نغمات الكورد
CHORDS = [
    (0,  0, [220.00, 261.63, 329.63, 440.00]),   # Am
    (0,  0, [174.61, 220.00, 349.23, 349.23]),   # F
    (0,  0, [261.63, 329.63, 392.00, 523.25]),   # C
    (0,  0, [196.00, 246.94, 392.00, 493.88]),   # G
]
ROOTS = [55.00, 43.65, 65.41, 49.00]             # A1 F1 C2 G1

def build():
    out = np.zeros(N, dtype=np.float32)
    K, S, H = kick(), snare(), hat()
    bar = 0
    tb = 0.0
    while tb < DUR - 0.05:
        ci = bar % 4
        root = ROOTS[ci]
        chord = CHORDS[ci][2]
        intro = tb < 3.7          # أول بارين: drums خفيفة
        # --- drums
        for b in range(4):
            at = tb + b * BEAT
            if at >= DUR:
                break
            if not (intro and b % 2 == 1):
                add(out, K * (0.55 if intro else 1.0), at)
            if b in (1, 3) and not intro:
                add(out, S * 0.55, at)
            add(out, H * (0.22 if intro else 0.34), at)
            add(out, H * 0.16, at + BEAT / 2)
        # --- بيس (ثمن نغمات)
        for e in range(8):
            at = tb + e * BEAT / 2
            if at >= DUR:
                break
            if intro and e % 2:
                continue
            f = root * (2.0 if e == 7 else 1.0)
            add(out, bass_note(f, BEAT / 2 * 0.95), at)
        # --- أربيجيو 16th
        if not intro:
            for s in range(16):
                at = tb + s * BEAT / 4
                if at >= DUR:
                    break
                add(out, pluck(chord[s % 4] * 2, BEAT / 4 * 0.9), at)
        bar += 1
        tb += BAR

    # riser قبل النهاية
    add(out, riser(2.0) * 0.5, DUR - 3.2)
    # ضربة نهائية
    add(out, K * 1.0, DUR - 1.6)
    add(out, S * 0.4, DUR - 1.6)

    # soft clip + fades
    out = np.tanh(out * 1.25)
    fi = int(0.35 * SR)
    out[:fi] *= np.linspace(0, 1, fi)
    fo = int(2.2 * SR)
    out[-fo:] *= np.linspace(1, 0, fo) ** 1.5
    return out / (np.abs(out).max() + 1e-9) * 0.9

def write_wav(path, data):
    pcm = (np.clip(data, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())

if __name__ == '__main__':
    m = build()
    write_wav('/tmp/vid/music.wav', m)
    print('music.wav', round(len(m) / SR, 2), 's')
