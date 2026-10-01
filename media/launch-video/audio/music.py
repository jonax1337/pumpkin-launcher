"""Pumpkin Launcher — "One Take" soundtrack.

A small chiptune synth: band-limited pulse leads (PolyBLEP), triangle bass,
noise drums, plus the SFX that sit on the camera beats. 120 BPM, 44 s.

    python audio/music.py            -> audio/soundtrack.wav (then: node build.mjs)
"""
import numpy as np
import wave, os
from scipy.signal import lfilter

SR = 44100
BPM = 120
BEAT = 60 / BPM          # 0.5 s
BAR = 4 * BEAT           # 2 s
S16 = BEAT / 4           # sixteenth
LEN = 44.0
N = int(LEN * SR)

# three buses: music (gets sidechained in the drop), drums, sfx
BUSES = {k: (np.zeros(N), np.zeros(N)) for k in ("mus", "drm", "sfx")}
CUR = "mus"
rng = np.random.default_rng(7)

NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6,
        "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def hz(name):
    n, o = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((12 * (o + 1) + NOTE[n] - 69) / 12)


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ---------------------------------------------------------------- oscillators
def polyblep(ph, dt):
    out = np.zeros_like(ph)
    m = ph < dt
    x = ph[m] / dt[m]
    out[m] = x + x - x * x - 1
    m2 = ph > 1 - dt
    x = (ph[m2] - 1) / dt[m2]
    out[m2] = x * x + x + x + 1
    return out


def pulse(freq, n, duty=0.5):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,)).copy()
    dt = f / SR
    ph = np.cumsum(dt) % 1.0
    sq = np.where(ph < duty, 1.0, -1.0)
    sq += polyblep(ph, dt)
    sq -= polyblep((ph + (1 - duty)) % 1.0, dt)
    return sq - (2 * duty - 1)


def tri(freq, n):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    ph = np.cumsum(f / SR) % 1.0
    t = 4 * np.abs(ph - 0.5) - 1
    return np.round(t * 7.5) / 7.5          # 16-step triangle, NES style


def env(n, a=0.004, d=0.08, s=0.6, r=0.05):
    t = np.arange(n) / SR
    e = np.ones(n) * s
    ai = t < a
    e[ai] = t[ai] / a
    di = (t >= a) & (t < a + d)
    e[di] = 1 - (1 - s) * (t[di] - a) / d
    rs = max(0, n - int(r * SR))
    if rs < n:
        e[rs:] *= np.linspace(1, 0, n - rs)
    return e


def add(sig, start, gain=1.0, pan=0.0, bus=None):
    i = int(round(start * SR))
    if i >= N or i + len(sig) <= 0:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    j = min(N, i + len(sig))
    s = sig[: j - i] * gain
    bl, br = BUSES[bus or CUR]
    bl[i:j] += s * np.sqrt(0.5 * (1 - pan))
    br[i:j] += s * np.sqrt(0.5 * (1 + pan))


def note(name_or_hz, start, dur, kind="pulse", duty=0.5, gain=0.2, pan=0.0,
         a=0.004, d=0.08, s=0.6, r=0.04, vib=0.0, slide=None, bus=None):
    f = hz(name_or_hz) if isinstance(name_or_hz, str) else name_or_hz
    n = int(dur * SR)
    if n <= 0:
        return
    t = np.arange(n) / SR
    freq = np.full(n, float(f))
    if vib:
        freq *= 1 + vib * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.12) / 0.2, 0, 1)
    if slide is not None:
        freq *= 2 ** (slide * np.clip(t / dur, 0, 1) / 12)
    osc = pulse(freq, n, duty) if kind == "pulse" else tri(freq, n)
    add(osc * env(n, a, d, s, r), start, gain, pan, bus=bus)


def onepole(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    return lfilter([1 - a], [1, -a], x)


# ---------------------------------------------------------------- drums
def kick(t0, g=0.55):
    n = int(0.28 * SR)
    t = np.arange(n) / SR
    f = 42 + 140 * np.exp(-t * 32)
    s = np.sin(2 * np.pi * np.cumsum(f / SR)) * np.exp(-t * 11)
    k = int(0.004 * SR)
    s[:k] += rng.uniform(-1, 1, k) * 0.35
    add(np.tanh(s * 1.6), t0, g, bus="drm")


def noise_burst(t0, dur, g, lp=None, hp=None, decay=30.0, pan=0.0, step=3, bus=None):
    n = int(dur * SR)
    t = np.arange(n) / SR
    raw = rng.uniform(-1, 1, n // step + 1).repeat(step)[:n]   # sample-and-hold crunch
    if hp:
        raw = raw - onepole(raw, hp)
    if lp:
        raw = onepole(raw, lp)
    add(raw * np.exp(-t * decay), t0, g, pan, bus=bus)


def snare(t0, g=0.3):
    noise_burst(t0, 0.18, g, lp=7000, hp=900, decay=22, bus="drm")
    note(190, t0, 0.07, "tri", gain=g * 0.9, a=0.001, d=0.05, s=0.0, r=0.02, slide=-7, bus="drm")


def hat(t0, g=0.07, open_=False, pan=0.25):
    noise_burst(t0, 0.16 if open_ else 0.045, g, hp=7000, decay=18 if open_ else 80, pan=pan, step=1, bus="drm")


def crash(t0, g=0.22):
    noise_burst(t0, 2.4, g, hp=4000, decay=1.8, pan=-0.2, step=1, bus="drm")
    noise_burst(t0, 2.4, g, hp=4500, decay=1.9, pan=0.2, step=1, bus="drm")


# ---------------------------------------------------------------- SFX
def whoosh(t0, dur, g=0.25, up=True, f0=300, f1=5000):
    n = int(dur * SR)
    t = np.arange(n) / SR
    raw = rng.uniform(-1, 1, n)
    out = np.zeros(n)
    blk, zi = 256, np.array([0.0])
    for i in range(0, n, blk):
        p = i / n
        fc = (f0 * (f1 / f0) ** p) if up else (f1 * (f0 / f1) ** p)
        a = np.exp(-2 * np.pi * fc / SR)
        y, zi = lfilter([1 - a], [1, -a], raw[i:i + blk], zi=zi)
        out[i:i + blk] = y
    hp_out = out - onepole(out, 120)
    p = np.clip(t / dur, 0, 1)
    shape = (p ** 1.6) * (1 - p) ** 0.35 if up else np.sin(np.pi * p) ** 0.8
    shape /= shape.max() + 1e-9
    add(hp_out * shape * 2.5, t0, g, -0.3)
    add(hp_out[::-1] * shape * 1.2, t0, g * 0.5, 0.35)


def blip(t0, f=880.0, g=0.12, dur=0.08, duty=0.25, slide=12, pan=0.0):
    note(f, t0, dur, duty=duty, gain=g, a=0.001, d=0.03, s=0.5, r=0.03, slide=slide, pan=pan)


def coin(t0, g=0.14, base="B5", jump="E6"):
    note(base, t0, 0.07, duty=0.5, gain=g, a=0.001, d=0.02, s=0.9, r=0.01)
    note(jump, t0 + 0.07, 0.42, duty=0.5, gain=g, a=0.001, d=0.3, s=0.25, r=0.1)


def sparkle(t0, notes, g=0.08, step=0.045, pan=0.3):
    for i, nn in enumerate(notes):
        note(nn, t0 + i * step, 0.18, duty=0.125, gain=g * (1 - i * 0.06), a=0.001, d=0.1, s=0.2, r=0.06,
             pan=pan if i % 2 else -pan)


def boom(t0, g=0.6):
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    f = 28 + 90 * np.exp(-t * 6)
    s = np.sin(2 * np.pi * np.cumsum(f / SR)) * np.exp(-t * 2.4)
    add(np.tanh(s * 2.0), t0, g)


def echo(t0, t1, delay=0.375, fb=0.35, mix=0.35):
    L, R = BUSES["mus"]
    i0, i1 = int(t0 * SR), int(t1 * SR)
    d = int(delay * SR)
    srcL, srcR = L[i0:i1].copy(), R[i0:i1].copy()
    g = mix
    for k in range(1, 5):
        a = i0 + k * d
        if a >= N:
            break
        b = min(N, a + len(srcL))
        if k % 2:
            R[a:b] += srcL[: b - a] * g
        else:
            L[a:b] += srcR[: b - a] * g
        g *= fb


# ================================================================ SCORE
chords = {
    "Am": ["A", "C", "E"], "F": ["F", "A", "C"], "C": ["C", "E", "G"], "G": ["G", "B", "D"],
    "Dm": ["D", "F", "A"], "E": ["E", "G#", "B"],
}
root_oct = {"Am": "A2", "F": "F2", "C": "C3", "G": "G2", "Dm": "D3", "E": "E2"}


def arp(chord, t0, bars=1, octave=5, g=0.045, duty=0.125, pattern=(0, 1, 2, 1), step=S16, pan=0.35):
    tones = chords[chord]
    for i in range(int(bars * BAR / step)):
        k = pattern[i % len(pattern)]
        nm = tones[k % 3] + str(octave + (1 if k >= 3 else 0))
        note(nm, t0 + i * step, step * 0.95, duty=duty, gain=g, a=0.001, d=0.05, s=0.45, r=0.02,
             pan=pan if (i // 2) % 2 else -pan)


def bass(chord, t0, bars=1, g=0.28, style="bounce"):
    rf = hz(root_oct[chord])
    if style == "whole":
        note(rf, t0, BAR * bars - 0.02, "tri", gain=g, a=0.01, d=0.2, s=0.8, r=0.2)
        return
    for i in range(int(bars * 8)):
        f = rf * (2 if i % 2 else 1) if style == "bounce" else (rf if i % 4 != 3 else rf * 1.5)
        note(f, t0 + i * BEAT / 2, BEAT / 2 * 0.9, "tri", gain=g, a=0.002, d=0.06, s=0.8, r=0.02)


def lead(seq, t0, g=0.11, duty=0.25, pan=-0.05, vib=0.004, wide=False):
    """seq: list of (note or None, length in eighths)."""
    t = t0
    for nm, ln in seq:
        dur = ln * BEAT / 2
        if nm:
            note(nm, t, dur * 0.94, duty=duty, gain=g, a=0.003, d=0.09, s=0.7, r=0.04, vib=vib, pan=pan)
            note(nm[:-1] + str(int(nm[-1]) - 1), t, dur * 0.94, duty=0.5, gain=g * 0.28, a=0.003, d=0.09,
                 s=0.6, r=0.04, pan=-pan)
            if wide:
                for det, pn in ((1.0065, 0.55), (0.9935, -0.55)):
                    note(hz(nm) * det, t, dur * 0.94, duty=0.125, gain=g * 0.5, a=0.003, d=0.09, s=0.7, r=0.04,
                         vib=vib, pan=pn)
        t += dur


# ---- INTRO 0–4: floating arps, no drums
for b, ch in enumerate(["Am", "F"]):
    arp(ch, b * BAR, octave=4, g=0.038, pattern=(0, 1, 2, 3, 2, 1), step=S16 * 2)
    bass(ch, b * BAR, style="whole", g=0.16)
note("E6", 0.5, 0.25, duty=0.125, gain=0.03)
note("A6", 1.75, 0.25, duty=0.125, gain=0.025)
note("C7", 2.9, 0.25, duty=0.125, gain=0.02)
echo(0, 4.0, delay=0.375, fb=0.4, mix=0.35)

# ---- ISLANDS 4–20: four 2-bar phrases, one per source
isl = [("Am", "F"), ("C", "G"), ("Am", "F"), ("Dm", "E")]
motifs = [
    [("E5", 2), ("A5", 2), ("G5", 1), ("E5", 1), ("D5", 1), ("C5", 1), ("D5", 3), ("E5", 1), ("C5", 2), ("A4", 2)],
    [("E5", 2), ("G5", 2), ("C6", 1), ("B5", 1), ("G5", 2), ("D5", 3), ("G5", 1), ("B5", 2), ("A5", 1), ("G5", 1)],
    [("E5", 2), ("A5", 2), ("G5", 1), ("E5", 1), ("D5", 1), ("C5", 1), ("D5", 2), ("E5", 1), ("F5", 1), ("A5", 2), ("C6", 2)],
    [("D5", 2), ("F5", 2), ("A5", 1), ("G5", 1), ("F5", 2), ("E5", 3), ("G#5", 1), ("B5", 2), ("E5", 2)],
]
for k, (c1, c2) in enumerate(isl):
    t0 = 4 + k * 4
    for j, ch in enumerate((c1, c2)):
        tb = t0 + j * BAR
        arp(ch, tb, octave=5, g=0.032)
        bass(ch, tb, style="bounce", g=0.22)
        for bt in range(4):
            if bt in (0, 2):
                kick(tb + bt * BEAT, 0.34 if k == 0 else 0.42)
            if k >= 1 and bt in (1, 3):
                snare(tb + bt * BEAT, 0.16 if k == 1 else 0.22)
            for h in range(2):
                hat(tb + bt * BEAT + h * BEAT / 2, 0.035 + 0.01 * h)
    lead(motifs[k], t0, g=0.085 + 0.01 * k)

# ---- BUILD 20–24: F → G, snare roll, riser, a breath before the drop
for j, ch in enumerate(["F", "G"]):
    tb = 20 + j * BAR
    arp(ch, tb, octave=5, g=0.03 + 0.012 * j)
    bass(ch, tb, style="drive", g=0.22)
roll_t = 20.0
while roll_t < 23.5:
    p = (roll_t - 20) / 3.5
    snare(roll_t, 0.06 + 0.16 * p)
    roll_t += BEAT if p < 0.3 else (BEAT / 2 if p < 0.6 else (BEAT / 4 if p < 0.85 else BEAT / 8))
for i in range(14):
    note(midi_hz(64 + i), 21.0 + i * 0.18, 0.16, duty=0.125, gain=0.03 + i * 0.002, a=0.001, d=0.05, s=0.5,
         r=0.03, pan=0.3 if i % 2 else -0.3)
whoosh(21.2, 2.3, g=0.12, up=True, f0=200, f1=7000)

# ---- DROP 24–36: C G Am F C G, full groove, main hook
drop = ["C", "G", "Am", "F", "C", "G"]
hook = [
    [("G5", 1), ("E5", 1), ("G5", 1), ("C6", 1), ("B5", 2), ("G5", 2)],
    [("D6", 2), ("B5", 1), ("G5", 1), ("A5", 1), ("B5", 1), ("G5", 2)],
    [("E6", 2), ("C6", 1), ("A5", 1), ("B5", 1), ("C6", 1), ("A5", 2)],
    [("A5", 2), ("C6", 2), ("F6", 1), ("E6", 1), ("D6", 1), ("C6", 1)],
    [("G5", 1), ("E5", 1), ("G5", 1), ("C6", 1), ("E6", 2), ("D6", 1), ("C6", 1)],
    [("D6", 3), ("B5", 1), ("G5", 2), (None, 2)],
]
for j, ch in enumerate(drop):
    tb = 24 + j * BAR
    arp(ch, tb, octave=5, g=0.03, pattern=(0, 1, 2, 3))
    bass(ch, tb, style="drive", g=0.25)
    for bt in range(4):
        kick(tb + bt * BEAT, 0.5 if bt in (0, 2) else 0.3)
        if bt in (1, 3):
            snare(tb + bt * BEAT, 0.24)
        hat(tb + bt * BEAT + BEAT / 2, 0.06, open_=(bt == 3))
        hat(tb + bt * BEAT + BEAT / 4, 0.025)
        hat(tb + bt * BEAT + 3 * BEAT / 4, 0.025)
    lead(hook[j], tb, g=0.1, duty=0.25 if j % 2 == 0 else 0.5, wide=True)
    rf = hz(root_oct[ch]) * 2
    for i8 in range(8):                                                    # pulse-bass octave for punch
        note(rf * (1.5 if i8 % 4 == 3 else 1), tb + i8 * BEAT / 2, BEAT / 2 * 0.7, duty=0.25, gain=0.045,
             a=0.002, d=0.05, s=0.5, r=0.02)
    for k, tn in enumerate(chords[ch]):
        note(tn + "4", tb, BAR - 0.05, duty=0.5, gain=0.018, a=0.05, d=0.3, s=0.7, r=0.3,
             pan=(-0.5, 0, 0.5)[k])

# ---- OUTRO 36–44: F G | C held
for j, ch in enumerate(["F", "G"]):
    tb = 36 + j * BAR
    arp(ch, tb, octave=5, g=0.03)
    bass(ch, tb, style="bounce", g=0.22)
    for bt in range(4):
        if bt in (0, 2):
            kick(tb + bt * BEAT, 0.45)
        if bt in (1, 3):
            snare(tb + bt * BEAT, 0.2)
        hat(tb + bt * BEAT + BEAT / 2, 0.05)
lead([("A5", 2), ("C6", 2), ("F6", 2), ("E6", 1), ("D6", 1), ("D6", 2), ("B5", 2), ("G5", 2), ("D6", 2)], 36, g=0.1)
kick(40.0, 0.55)
crash(40.0, 0.16)
for k, tn in enumerate(["C4", "E4", "G4", "C5", "E5", "G5"]):
    note(tn, 40.0, 3.9, duty=0.5 if k < 3 else 0.25, gain=0.035, a=0.005, d=0.8, s=0.45, r=2.6,
         pan=(-0.4, 0.4)[k % 2])
note("C2", 40.0, 3.8, "tri", gain=0.28, a=0.005, d=0.5, s=0.7, r=2.5)
for i in range(24):
    tn = ["C", "E", "G"][i % 3] + str(5 + (i // 3) % 2)
    note(tn, 40.0 + i * S16 * 1.5, 0.15, duty=0.125, gain=0.03 * (1 - i / 26), a=0.001, d=0.06, s=0.3, r=0.04,
         pan=0.4 if i % 2 else -0.4)

# ================================================================ SFX on camera beats
CUR = "sfx"
whoosh(0.0, 2.2, g=0.08, up=False, f0=250, f1=3000)                      # descend through the stars
for t_isl in (4, 8, 12, 16):
    whoosh(t_isl - 0.9, 0.9, g=0.14, up=True, f0=300, f1=6000)             # fly-in to each island
    sparkle(t_isl, ["E6", "A6", "C7", "E7"] if t_isl != 16 else ["D6", "F6", "A6", "D7"], g=0.07)
    for i in range(4):                                                     # content icons pop
        blip(t_isl + 0.5 + i * 0.5, f=hz("C6") * 2 ** (i * 4 / 12), g=0.06, dur=0.07, slide=7,
             pan=(-0.4, 0.4)[i % 2])
whoosh(19.8, 1.6, g=0.2, up=False, f0=200, f1=5000)                       # pull back
boom(24.0, 0.55)                                                           # drop impact
crash(24.0, 0.22)
sparkle(24.02, ["C6", "E6", "G6", "C7", "E7", "G7", "C8"], g=0.075, step=0.04)
for i in range(6):                                                         # window unfolds in steps
    blip(25.0 + i * 0.09, f=hz("G5") * 2 ** (i * 2 / 12), g=0.05, dur=0.06, duty=0.5, slide=0)
whoosh(24.8, 1.0, g=0.1, up=True, f0=500, f1=8000)
noise_burst(29.47, 0.03, 0.2, hp=2000, decay=200)                          # click "Anlegen"
blip(29.47, f=hz("E5"), g=0.07, dur=0.05, duty=0.5, slide=-12)
for i in range(4):                                                         # Buddy bonks the source switcher
    note(hz("C5"), 27.5 + i * 0.5, 0.14, "tri", gain=0.16, a=0.001, d=0.08, s=0.3, r=0.03, slide=14)
    blip(27.5 + i * 0.5, f=hz("A5"), g=0.04, dur=0.04, duty=0.5, slide=12)
for i in range(5):                                                         # loader chips 30–32
    blip(30.0 + i * 0.5, f=hz("C6") * 2 ** ([0, 2, 4, 7, 9][i] / 12), g=0.065, dur=0.09, duty=0.25, slide=12)
noise_burst(33.0, 0.03, 0.25, hp=2000, decay=200)                          # click
blip(33.0, f=hz("C5"), g=0.08, dur=0.05, duty=0.5, slide=-12)
for i in range(16):                                                        # progress cells
    blip(33.25 + i * 0.1, f=hz("C5") * 2 ** (i / 12), g=0.045, dur=0.04, duty=0.125, slide=0)
coin(34.9, g=0.1, base="G5", jump="C6")
whoosh(35.0, 1.6, g=0.22, up=True, f0=150, f1=9000)                       # dive into the world
note(hz("C5"), 37.0, 0.22, duty=0.25, gain=0.07, a=0.001, d=0.1, s=0.6, r=0.05, slide=12)   # buddy jump
coin(38.0, g=0.12)                                                         # wordmark
sparkle(38.05, ["G6", "C7", "E7", "G7"], g=0.05)

# ---- Buddy
def whirr(t0, dur, g=0.03):
    n = int(dur * SR)
    t = np.arange(n) / SR
    raw = rng.uniform(-1, 1, n)
    band = onepole(raw, 2400) - onepole(raw, 700)
    am = 0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 34 * t))
    shape = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.6
    add(band * am * shape * 3, t0, g)


def boing(t0, g=0.12, base="C5", semis=14):
    note(hz(base), t0, 0.16, "tri", gain=g, a=0.001, d=0.1, s=0.3, r=0.04, slide=semis)
    note(hz(base) * 2, t0, 0.1, duty=0.25, gain=g * 0.25, a=0.001, d=0.05, s=0.3, r=0.03, slide=semis)


blip(3.0, f=hz("E6"), g=0.07, dur=0.06, duty=0.25, slide=0)                # wakes up: "!"
blip(3.07, f=hz("A6"), g=0.07, dur=0.1, duty=0.25, slide=0)
note(hz("C5"), 3.3, 0.35, duty=0.25, gain=0.07, a=0.002, d=0.1, s=0.7, r=0.05, slide=19)   # take-off
for a0, d0 in ((3.2, 0.9), (6.7, 1.3), (10.7, 1.3), (14.7, 1.3), (18.7, 4.6), (25.6, 0.4), (35.0, 1.5)):
    whirr(a0, d0, 0.035)
for T in (4, 8, 12, 16):                                                  # items caught into the orbit
    for j in range(4):
        note(hz("G6") * 2 ** (j * 2 / 12), T + 1.3 + j * 0.5, 0.09, "tri", gain=0.05, a=0.001, d=0.05, s=0.3,
             r=0.02, pan=(-0.3, 0.3)[j % 2])
note(hz("C7"), 23.5, 0.5, duty=0.25, gain=0.05, a=0.002, d=0.1, s=0.8, r=0.02, slide=-24)   # slam whistle
nrev = int(1.5 * SR)                                                      # reverse cymbal into the drop
rc = rng.uniform(-1, 1, nrev)
rc = rc - onepole(rc, 3000)
add(rc * np.linspace(0, 1, nrev) ** 2.2, 22.5, 0.12)
boing(32.25, g=0.1, base="E5")                                            # picks Fabric
note(hz("G4"), 32.4, 0.3, duty=0.25, gain=0.06, a=0.002, d=0.1, s=0.7, r=0.04, slide=12)   # leap to SPIELEN
boing(36.5, g=0.14, base="G4", semis=12)                                  # lands in the world
blip(39.6, f=hz("G6"), g=0.06, dur=0.08, slide=0)                         # waves
blip(39.72, f=hz("C7"), g=0.06, dur=0.12, slide=0)
for T in (4, 8, 12, 16):                                                  # Buddy swallows the orbit on departure
    t0 = T + 2.72 + (0.35 if T == 16 else 0)
    for j in range(4):
        note(hz("E6") * 2 ** (-j * 3 / 12), t0 + 0.3 + j * 0.05, 0.06, "tri", gain=0.045, a=0.001, d=0.04, s=0.3, r=0.02)

# ================================================================ sidechain + sum
tt = np.arange(N) / SR
duck = np.ones(N)
for kb in np.arange(24.0, 36.0, BEAT):
    m = (tt >= kb) & (tt < kb + BEAT)
    duck[m] = 1 - 0.42 * np.exp(-(tt[m] - kb) / 0.07)
for kb in (36.0, 37.0, 38.0, 39.0, 40.0):
    m = (tt >= kb) & (tt < kb + 1.0)
    duck[m] = np.minimum(duck[m], 1 - 0.3 * np.exp(-(tt[m] - kb) / 0.08))
L = BUSES["mus"][0] * duck + BUSES["drm"][0] + BUSES["sfx"][0]
R = BUSES["mus"][1] * duck + BUSES["drm"][1] + BUSES["sfx"][1]

# ================================================================ master
mix = np.stack([L, R], axis=1)
mix = np.tanh(mix * 1.3) / np.tanh(1.3)
fi = int(0.02 * SR)
mix[:fi] *= np.linspace(0, 1, fi)[:, None]
fo = int(1.2 * SR)
mix[-fo:] *= (np.linspace(1, 0, fo) ** 2)[:, None]
mix = mix / np.max(np.abs(mix)) * 10 ** (-1 / 20)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "soundtrack.wav")
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
rms = np.sqrt(np.mean(mix ** 2))
print("wrote", os.path.abspath(out), f"{LEN}s, peak -1 dBFS, rms {20 * np.log10(rms):.1f} dBFS")
