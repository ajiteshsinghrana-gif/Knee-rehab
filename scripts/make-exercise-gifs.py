#!/usr/bin/env python3
"""
Draws the exercise animations (public/media/gif/<exercise-id>.gif): original stick-figure drawings, made here, so there is nothing
to license. Run:  python3 scripts/make-exercise-gifs.py [exercise-id ...] [--sheet out.png]

A figure faces right. Angles are in degrees measured from "straight down", so direction(a) = (sin a, cos a) on the screen:
0 down, 90 right, 180 up, -90 left. Legs and arms can be given as angles (thN, shN ...) or as a target for the foot or hand
(anN, wrN ...) and the knee or elbow is worked out. The working limb is drawn in orange.

These are DRAFTS of how each exercise looks. The physio decides what the patient should do; the pictures never replace that.
"""
import math, sys, os
from PIL import Image, ImageDraw

W = 240                      # picture size (px)
SS = 2                       # drawn at 2x, then reduced, so edges are smooth
FLOOR = 202
BG = (215, 240, 238)
INK = (29, 53, 87)
FAR = (118, 140, 168)
HOT = (231, 111, 81)
PROP = (150, 160, 170)
WOOD = (176, 137, 104)
ICE = (92, 184, 224)
T_, S_, FT, TR, UA, FA, HR = 44, 44, 16, 56, 28, 26, 10


def d(a):
    r = math.radians(a)
    return (math.sin(r), math.cos(r))


def add(p, v, k=1.0):
    return (p[0] + v[0] * k, p[1] + v[1] * k)


def ik(root, target, l1, l2, side):
    """Middle joint of a two-bone limb from `root` to `target`. side -1 bends towards the front for a right-facing figure."""
    dx, dy = target[0] - root[0], target[1] - root[1]
    dist = max(abs(l1 - l2) + 0.5, min(l1 + l2 - 0.2, math.hypot(dx, dy)))
    a = math.atan2(dy, dx)
    c = max(-1.0, min(1.0, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)))
    t = a + side * math.acos(c)
    mid = (root[0] + l1 * math.cos(t), root[1] + l1 * math.sin(t))
    # if the target was out of reach the end is pulled to what the bones can reach
    end = (root[0] + dist * math.cos(a), root[1] + dist * math.sin(a))
    return mid, end


def lerp(a, b, t):
    if isinstance(a, (tuple, list)):
        return tuple(lerp(x, y, t) for x, y in zip(a, b))
    if isinstance(a, (int, float)):
        return a + (b - a) * t
    return a


def ease(t):
    return t * t * (3 - 2 * t)


def at(keys, u):
    """Pose at u (0..1 round a loop). keys: [(time, pose)] with the last time 1.0 and the same keys in every pose."""
    for (t0, p0), (t1, p1) in zip(keys, keys[1:]):
        if t0 <= u <= t1:
            k = 0 if t1 == t0 else ease((u - t0) / (t1 - t0))
            out = {}
            for n in set(p0) | set(p1):
                if n == 'hl' or n not in p0 or n not in p1:
                    out[n] = p0.get(n, p1.get(n))
                else:
                    out[n] = lerp(p0[n], p1[n], k)
            return out
    return dict(keys[-1][1])


class Canvas:
    def __init__(self):
        self.im = Image.new('RGB', (W * SS, W * SS), BG)
        self.g = ImageDraw.Draw(self.im, 'RGBA')

    def _p(self, p):
        return (p[0] * SS, p[1] * SS)

    def seg(self, p, q, w=9, col=INK):
        a, b, r = self._p(p), self._p(q), w * SS / 2
        self.g.line([a, b], fill=col, width=int(w * SS))
        for e in (a, b):
            self.g.ellipse([e[0] - r, e[1] - r, e[0] + r, e[1] + r], fill=col)

    def dot(self, p, r, col=INK):
        x, y = self._p(p)
        self.g.ellipse([x - r * SS, y - r * SS, x + r * SS, y + r * SS], fill=col)

    def rect(self, x0, y0, x1, y1, col=PROP, r=0):
        box = [x0 * SS, y0 * SS, x1 * SS, y1 * SS]
        (self.g.rounded_rectangle(box, radius=r * SS, fill=col) if r else self.g.rectangle(box, fill=col))

    def poly(self, pts, col=PROP):
        self.g.polygon([self._p(p) for p in pts], fill=col)

    def ring(self, p, r, col=PROP, w=3):
        x, y = self._p(p)
        self.g.ellipse([x - r * SS, y - r * SS, x + r * SS, y + r * SS], outline=col, width=int(w * SS))

    def arrow(self, p, q, col=HOT, w=3):
        self.seg(p, q, w, col)
        ang = math.atan2(q[1] - p[1], q[0] - p[0])
        for s in (-1, 1):
            h = (q[0] - 8 * math.cos(ang + s * 0.5), q[1] - 8 * math.sin(ang + s * 0.5))
            self.seg(q, h, w, col)

    def done(self):
        return self.im.resize((W, W), Image.LANCZOS)


# ---------------------------------------------------------------- the figure
def figure(c, P):
    """Draws the person described by pose P. Returns joint positions (for props that follow the body)."""
    wide = P.get('wide', 0)
    hip = P['hip']
    hips = {'N': (hip[0] + wide, hip[1]), 'F': (hip[0] - wide, hip[1])}
    sh = add(hip, d(P['tr']), TR)
    shs = {'N': (sh[0] + wide * 1.5, sh[1]), 'F': (sh[0] - wide * 1.5, sh[1])}
    hot = P.get('hl', ())
    out = {'hip': hip, 'sh': sh}

    def leg(k):
        if f'an{k}' in P:
            knee, ank = ik(hips[k], P[f'an{k}'], T_, S_, P.get('kside', -1))
        else:
            knee = add(hips[k], d(P[f'th{k}']), T_)
            ank = add(knee, d(P[f'sh{k}']), S_)
        shin_a = math.degrees(math.atan2(ank[0] - knee[0], ank[1] - knee[1]))
        ft = P.get(f'ft{k}')
        if ft is None:
            ft = 90 if ank[1] >= 195 else shin_a + 90
        toe = add(ank, d(ft), FT)
        return knee, ank, toe

    def arm(k):
        if f'wr{k}' in P:
            el, wr = ik(shs[k], P[f'wr{k}'], UA, FA, P.get('aside', 1))
        else:
            el = add(shs[k], d(P[f'ua{k}']), UA)
            wr = add(el, d(P[f'fa{k}']), FA)
        return el, wr

    legs = {k: leg(k) for k in 'FN'}
    arms = {k: arm(k) for k in 'FN'}
    out['legs'], out['arms'] = legs, arms

    def draw_leg(k, col):
        knee, ank, toe = legs[k]
        c.seg(hips[k], knee, 9, HOT if f'leg{k}' in hot else col)
        c.seg(knee, ank, 9, HOT if f'leg{k}' in hot else col)
        c.seg(ank, toe, 8, HOT if f'leg{k}' in hot else col)

    def draw_arm(k, col):
        el, wr = arms[k]
        a = HOT if f'arm{k}' in hot else col
        c.seg(shs[k], el, 7, a)
        c.seg(el, wr, 7, a)
        if 'hand' in P and k == 'N':
            c.seg(wr, add(wr, d(P['hand']), 12), 6, a)

    draw_leg('F', FAR)
    if not P.get('noarmF'):
        draw_arm('F', FAR)
    c.seg(hip, sh, 11, HOT if 'trunk' in hot else INK)
    draw_leg('N', INK)
    if not P.get('noarmN'):
        draw_arm('N', INK)
    hd = add(sh, d(P['tr'] + P.get('nk', 0)), 8 + HR)
    c.dot(hd, HR, INK)
    out['head'] = hd
    return out


def base(**kw):
    p = dict(hip=(120, 108.5), tr=180, anN=(122, 197), anF=(114, 197), uaN=0, faN=0, uaF=0, faF=0)
    p.update(kw)
    return p


def lying(**kw):
    """On the back, head to the left, body on the bed."""
    p = dict(hip=(104, 197), tr=-90, uaN=90, faN=90, uaF=90, faF=90, anN=(192, 197), anF=(192, 197), nk=0)
    p.update(kw)
    return p


def floor(c, y=FLOOR):
    c.rect(0, y, W, W, (190, 214, 214))
    c.rect(0, y, W, y + 2, (150, 185, 185))


def bed(c):
    c.rect(10, 200, 230, 206, WOOD, 2)
    c.rect(10, 206, 230, 212, (140, 105, 80))


def chair(c, x, seat_y=158, w=44, back=True):
    c.rect(x, seat_y, x + w, seat_y + 5, WOOD, 1)
    c.rect(x + 3, seat_y, x + 8, FLOOR, WOOD)
    c.rect(x + w - 8, seat_y, x + w - 3, FLOOR, WOOD)
    if back:
        c.rect(x, seat_y - 56, x + 5, seat_y, WOOD, 1)


def step(c, x0, x1, top):
    c.rect(x0, top, x1, FLOOR, (186, 168, 140), 2)
    c.rect(x0, top, x1, top + 3, (150, 130, 105))


def wall(c, x):
    c.rect(x, 0, W, FLOOR, (236, 226, 214))
    c.rect(x - 3, 0, x, FLOOR, (200, 188, 172))


def table(c, x0, x1, y):
    c.rect(x0, y, x1, y + 5, WOOD, 1)
    c.rect(x0 + 6, y + 5, x0 + 12, FLOOR, WOOD)
    c.rect(x1 - 12, y + 5, x1 - 6, FLOOR, WOOD)


def snow(c, p, r=7, col=ICE):
    for a in range(0, 180, 60):
        v = d(a + 90)
        c.seg((p[0] - v[0] * r, p[1] - v[1] * r), (p[0] + v[0] * r, p[1] + v[1] * r), 2, col)


# ---------------------------------------------------------------- the exercises
EX = {}


def ex(name, frames=24, ms=70):
    def reg(fn):
        EX[name] = (fn, frames, ms)
        return fn
    return reg


@ex('squats', 28, 75)
def _(c, u):
    up = base(uaN=90, faN=90, uaF=90, faF=90, hl=('legN', 'legF'))
    dn = base(hip=(90, 142), tr=140, uaN=90, faN=90, uaF=90, faF=90, anN=(122, 197), anF=(114, 197), hl=('legN', 'legF'))
    P = at([(0, up), (.45, dn), (.55, dn), (1, up)], u)
    floor(c); figure(c, P)
    c.arrow((196, 90), (196, 150))


@ex('mini-squats', 28, 75)
def _(c, u):
    up = base(uaN=90, faN=90, uaF=90, faF=90, hl=('legN', 'legF'))
    dn = base(hip=(104, 126), tr=158, uaN=90, faN=90, uaF=90, faF=90, hl=('legN', 'legF'))
    P = at([(0, up), (.45, dn), (.55, dn), (1, up)], u)
    floor(c); figure(c, P)
    c.arrow((196, 100), (196, 128))


@ex('lunges', 30, 75)
def _(c, u):
    up = base(anN=(124, 197), anF=(116, 197), hl=('legN', 'legF'))
    dn = base(hip=(120, 150), anN=(156, 197), anF=(84, 188), ftF=40, hl=('legN', 'legF'))
    P = at([(0, up), (.4, dn), (.55, dn), (1, up)], u)
    floor(c); figure(c, P)
    c.arrow((200, 120), (200, 158))


@ex('sit-to-stand', 32, 75)
def _(c, u):
    sit = base(hip=(98, 153), tr=160, anN=(138, 197), anF=(132, 197), uaN=70, faN=100, uaF=70, faF=100, hl=('legN', 'legF'))
    mid = base(hip=(110, 130), tr=125, anN=(138, 197), anF=(132, 197), uaN=80, faN=100, uaF=80, faF=100, hl=('legN', 'legF'))
    up = base(hip=(132, 109), tr=180, anN=(138, 197), anF=(132, 197), hl=('legN', 'legF'))
    P = at([(0, sit), (.3, mid), (.5, up), (.6, up), (.8, mid), (1, sit)], u)
    floor(c); chair(c, 58, 158, 52); figure(c, P)


@ex('step-ups', 32, 75)
def _(c, u):
    a = base(hip=(104, 108.5), anN=(112, 197), anF=(98, 197), hl=('legN',))
    b = base(hip=(120, 108.5), tr=174, anN=(150, 176), anF=(106, 197), hl=('legN',))
    top = base(hip=(150, 90), tr=178, anN=(150, 176), anF=(172, 160), hl=('legN',))
    P = at([(0, a), (.25, b), (.5, top), (.6, top), (.8, b), (1, a)], u)
    floor(c); step(c, 132, 190, 182); figure(c, P)


@ex('stairs-practice', 36, 75)
def _(c, u):
    a = base(hip=(70, 108.5), anN=(78, 197), anF=(64, 197), hl=('legN',))
    b = base(hip=(90, 108.5), tr=174, anN=(114, 178), anF=(74, 197), hl=('legN',))
    c1 = base(hip=(114, 92), tr=176, anN=(114, 178), anF=(132, 160), hl=('legN',))
    d2 = base(hip=(128, 90), tr=176, anN=(114, 178), anF=(142, 154), hl=('legN',))
    P = at([(0, a), (.25, b), (.5, c1), (.7, d2), (.85, b), (1, a)], u)
    floor(c)
    step(c, 100, 128, 184); step(c, 128, 160, 164); step(c, 160, 230, 144)
    c.seg((88, 120), (214, 56), 3, PROP)       # hand rail
    figure(c, P)


@ex('calf-raises', 24, 70)
def _(c, u):
    dn = base(hip=(120, 108.5), anN=(120, 197), anF=(112, 197), uaN=70, faN=100, uaF=70, faF=100, hl=('legN', 'legF'))
    up = base(hip=(121, 98.5), anN=(120, 187), anF=(112, 187), ftN=40, ftF=40, uaN=70, faN=100, uaF=70, faF=100, hl=('legN', 'legF'))
    P = at([(0, dn), (.4, up), (.6, up), (1, dn)], u)
    floor(c); chair(c, 168, 120, 40); figure(c, P)
    c.arrow((70, 120), (70, 84))


@ex('balance', 30, 80)
def _(c, u):
    a = base(hip=(120, 108.5), anN=(120, 197), anF=(130, 168), uaN=-65, faN=-80, uaF=60, faF=75, hl=('legN',))
    b = base(hip=(122, 108.5), anN=(120, 197), anF=(134, 164), uaN=-60, faN=-85, uaF=65, faF=80, hl=('legN',))
    P = at([(0, a), (.5, b), (1, a)], u)
    floor(c); chair(c, 168, 130, 40); figure(c, P)


@ex('gait-drills', 32, 70)
def _(c, u):
    stand = dict(hip=(120, 108.5), tr=180, anN=(120, 197), anF=(114, 197), uaN=0, faN=0, uaF=0, faF=0)
    kn = dict(stand, anN=(150, 156), uaN=-40, faN=-10, uaF=50, faF=60, hl=('legN',))
    kf = dict(stand, anF=(150, 156), uaN=50, faN=60, uaF=-40, faF=-10, hl=('legF',))
    P = at([(0, stand), (.2, kn), (.5, stand), (.7, kf), (1, stand)], u)
    for k in ('hl',):
        P.setdefault(k, ())
    floor(c); figure(c, P)


def walk_pose(u, aid=False):
    def foot(p):
        p %= 1.0
        if p < .6:
            s = p / .6
            return (120 + 28 - 56 * s, 197)
        s = (p - .6) / .4
        return (120 - 28 + 56 * ease(s), 197 - 18 * math.sin(math.pi * s))
    fn, ff = foot(u), foot(u + .5)
    sw = 28 * math.sin(2 * math.pi * u)
    P = base(hip=(120, 112 + 1.5 * math.cos(4 * math.pi * u)), tr=178, anN=fn, anF=ff,
             uaN=sw, faN=sw + 18, uaF=-sw, faF=-sw + 18, hl=('legN', 'legF'))
    return P


@ex('walking', 32, 70)
def _(c, u):
    floor(c); P = walk_pose(u); figure(c, P)
    for i in range(3):
        x = (i * 90 - u * 90) % 270 - 20
        c.rect(x, FLOOR + 10, x + 24, FLOOR + 13, (160, 196, 196))


@ex('walking-aid', 32, 70)
def _(c, u):
    floor(c); P = walk_pose(u)
    P['uaN'], P['faN'] = 32, 32
    o = figure(c, P)
    wr = o['arms']['N'][1]
    c.seg(wr, (wr[0] + 6, FLOOR), 4, PROP)            # a walking stick
    c.seg((wr[0] - 6, wr[1]), (wr[0] + 8, wr[1]), 5, PROP)


@ex('walking-programme', 32, 70)
def _(c, u):
    floor(c); P = walk_pose(u); figure(c, P)
    c.ring((204, 36), 18, (255, 255, 255), 5)
    t = u * 360
    c.g.arc([186 * SS, 18 * SS, 222 * SS, 54 * SS], -90, -90 + t if t > 2 else -89, fill=HOT, width=5 * SS)
    c.seg((204, 36), (204, 28), 2, INK); c.seg((204, 36), (210, 40), 2, INK)


@ex('straight-leg-raise', 30, 80)
def _(c, u):
    dn = lying(anN=(192, 197), anF=(130, 197), hl=('legN',))
    up = lying(anN=(166, 134), anF=(130, 197), ftN=200, hl=('legN',))
    P = at([(0, dn), (.4, up), (.6, up), (1, dn)], u)
    floor(c); bed(c); figure(c, P)
    c.arrow((200, 150), (200, 118))


@ex('heel-slides', 32, 80)
def _(c, u):
    a = lying(anN=(192, 196), anF=(192, 196), hl=('legN',))
    b = lying(anN=(140, 196), anF=(192, 196), hl=('legN',))
    P = at([(0, a), (.5, b), (1, a)], u)
    floor(c); bed(c); figure(c, P)
    c.arrow((196, 170), (150, 170))


@ex('quad-set', 24, 80)
def _(c, u):
    a = lying(anN=(190, 193), ftN=170, anF=(190, 193), ftF=170, hl=('legN',))
    b = lying(anN=(190, 191), ftN=205, anF=(190, 193), ftF=170, hl=('legN',))
    P = at([(0, a), (.4, b), (.7, b), (1, a)], u)
    floor(c); bed(c)
    c.rect(132, 188, 150, 200, (240, 240, 240), 5)   # a rolled towel under the knee
    figure(c, P)
    k = at([(0, 0.0), (.4, 1.0), (.7, 1.0), (1, 0.0)], u) if False else None
    s = ease(min(1, max(0, 1 - abs(u - 0.5) * 2.2)))
    c.arrow((147, 150), (147, 150 + 22 * s + 4))


@ex('gentle-rom', 32, 75)
def _(c, u):
    a = base(hip=(98, 153), tr=180, thN=90, shN=0, thF=90, shF=0, uaN=40, faN=100, uaF=40, faF=100, hl=('legN',))
    b = dict(a, shN=88, ftN=180)
    a = dict(a)
    for P in (a, b):
        P.pop('anN'); P.pop('anF')
    a['ftN'] = 90; a['ftF'] = 90; b['ftF'] = 90
    P = at([(0, a), (.5, b), (1, a)], u)
    floor(c); chair(c, 66, 158, 60); figure(c, P)


@ex('bridging', 32, 75)
def _(c, u):
    dn = lying(hip=(110, 197), anN=(150, 197), anF=(144, 197), hl=('trunk', 'legN', 'legF'))
    up = lying(hip=(101.3, 167), tr=-57.6, anN=(150, 197), anF=(144, 197), hl=('trunk', 'legN', 'legF'))
    P = at([(0, dn), (.4, up), (.6, up), (1, dn)], u)
    floor(c); bed(c); figure(c, P)
    c.arrow((126, 160), (126, 130))


@ex('ankle-pumps', 24, 70)
def _(c, u):
    a = lying(anN=(190, 196), anF=(190, 196), ftN=135, ftF=135, hl=('legN', 'legF'))
    b = lying(anN=(190, 196), anF=(190, 196), ftN=215, ftF=215, hl=('legN', 'legF'))
    P = at([(0, a), (.5, b), (1, a)], u)
    floor(c); bed(c); figure(c, P)
    c.arrow((212, 160), (212, 176), HOT)


@ex('hip-abduction', 28, 75)
def _(c, u):
    a = dict(hip=(120, 108.5), tr=180, wide=8, thN=0, shN=0, thF=0, shF=0, uaN=25, faN=25, uaF=-25, faF=-25, hl=('legN',))
    b = dict(a, thN=32, shN=32)
    P = at([(0, a), (.5, b), (1, a)], u)
    floor(c); chair(c, 28, 130, 40, back=False); figure(c, P)
    c.arrow((170, 190), (200, 190))


@ex('calf-placeholder', 2, 100)
def _(c, u):
    pass
del EX['calf-placeholder']


@ex('assisted-arm-raise', 32, 75)
def _(c, u):
    a = base(uaN=10, faN=10, uaF=10, faF=10, hl=('armN', 'armF'))
    b = base(uaN=150, faN=150, uaF=150, faF=150, hl=('armN', 'armF'))
    P = at([(0, a), (.5, b), (.6, b), (1, a)], u)
    floor(c); figure(c, P)
    c.arrow((190, 110), (190, 56))


@ex('wall-slide', 32, 75)
def _(c, u):
    lo = base(tr=172, wrN=(166, 76), wrF=(166, 80), hl=('armN', 'armF'))
    hi = base(tr=172, wrN=(166, 28), wrF=(166, 32), hl=('armN', 'armF'))
    P = at([(0, lo), (.5, hi), (.6, hi), (1, lo)], u)
    floor(c); wall(c, 172); figure(c, P)
    c.arrow((200, 90), (200, 40))


@ex('pendulum', 32, 70)
def _(c, u):
    sw = 26 * math.sin(2 * math.pi * u)
    P = base(hip=(96, 112), tr=108, anN=(84, 197), anF=(120, 197), uaN=sw, faN=sw, wrF=(176, 100), hl=('armN',))
    P['noarmN'] = False
    floor(c); table(c, 160, 224, 98); figure(c, P)


@ex('shoulder-blade-squeeze', 28, 80)
def _(c, u):
    k = ease(min(1, max(0, 1 - abs(u - 0.5) * 2.4)))
    gap = 22 - 9 * k
    c.rect(0, 0, W, W, BG)
    floor(c)
    hip = (120, 118); sh = (120, 66)
    c.seg((108, 118), (108, 196), 10, FAR); c.seg((132, 118), (132, 196), 10, FAR)    # legs
    c.seg(hip, sh, 14, INK)
    c.seg((120 - gap - 8, 66), (120 + gap + 8, 66), 10, INK)                           # shoulders
    c.dot((120, 44), 12, INK)
    el = 24 + 4 * k
    c.seg((120 - gap - 8, 66), (120 - gap - el * 0.4, 100), 7, INK); c.seg((120 + gap + 8, 66), (120 + gap + el * 0.4, 100), 7, INK)
    c.dot((120 - gap + 4, 82), 9, HOT); c.dot((120 + gap - 4, 82), 9, HOT)           # shoulder blades
    c.arrow((70, 82), (100 + (22 - gap) * .5, 82)); c.arrow((170, 82), (140 - (22 - gap) * .5, 82))


@ex('band-rotation', 30, 75)
def _(c, u):
    a = dict(hip=(120, 108.5), tr=180, wide=8, thN=0, shN=0, thF=0, shF=0, uaN=0, faN=-88, uaF=0, faF=-88, hl=('armN',))
    b = dict(a, faN=62)
    P = at([(0, a), (.5, b), (1, a)], u)
    P['wideArm'] = 0
    floor(c); o = figure(c, P)
    wr = o['arms']['N'][1]
    c.seg(wr, (212, wr[1] + 4), 3, (60, 150, 120)); c.dot((214, wr[1] + 4), 5, PROP)   # the band, held by a post


@ex('core', 36, 75)
def _(c, u):
    a = dict(hip=(120, 150), tr=94, thN=0, shN=-85, thF=0, shF=-85, uaN=0, faN=0, uaF=0, faF=0, nk=-8, hl=('trunk',))
    b = dict(a, thF=-90, shF=-90, uaN=90, faN=90, hl=('armN', 'legF'))
    P = at([(0, a), (.35, b), (.65, b), (1, a)], u)
    floor(c); figure(c, P)
    c.rect(70, FLOOR - 3, 190, FLOOR, (176, 205, 205), 2)


@ex('hand-wrist-elbow', 28, 80)
def _(c, u):
    a = base(hip=(88, 153), tr=180, thN=90, shN=0, thF=90, shF=0, uaN=20, faN=90, uaF=20, faF=90, hand=60)
    b = dict(a, hand=122)
    for P in (a, b):
        P.pop('anN'); P.pop('anF'); P['ftN'] = 90; P['ftF'] = 90
    a['hl'] = ('armN',); b['hl'] = ('armN',)
    P = at([(0, a), (.5, b), (1, a)], u)
    floor(c); chair(c, 56, 158, 50); table(c, 108, 200, 132); figure(c, P)


def bike_pose(u, stationary):
    th = 2 * math.pi * u
    C = (140, 168)
    r = 17
    pn = (C[0] + r * math.cos(th), C[1] + r * math.sin(th))
    pf = (C[0] - r * math.cos(th), C[1] - r * math.sin(th))
    return C, r, dict(hip=(100, 112), tr=150, anN=(pn[0] - 2, pn[1] - 3), anF=(pf[0] - 2, pf[1] - 3), ftN=88, ftF=88,
                      wrN=(158, 112), wrF=(156, 114), hl=('legN', 'legF'), kside=-1, aside=1)


@ex('stationary-cycling', 32, 55)
def _(c, u):
    C, r, P = bike_pose(u, True)
    floor(c)
    c.rect(70, FLOOR - 6, 190, FLOOR, PROP, 3)
    c.seg((96, 122), (96, FLOOR - 6), 5, PROP); c.rect(86, 116, 112, 124, (90, 90, 90), 3)       # saddle
    c.seg(C, (168, 130), 5, PROP); c.seg((168, 130), (160, 108), 5, PROP); c.seg((152, 108), (166, 108), 5, PROP)
    c.seg(C, (96, 142), 4, PROP)
    c.ring((176, 168), 22, PROP, 4)
    figure(c, P)
    c.dot(C, 4, PROP)


@ex('cycling', 32, 55)
def _(c, u):
    C, r, P = bike_pose(u, False)
    floor(c)
    sp = 360 * u * 2
    for wx in (82, 182):
        c.ring((wx, 168), 30, INK, 3)
        for a in (0, 60, 120):
            v = d(a + sp)
            c.seg((wx - v[0] * 28, 168 - v[1] * 28), (wx + v[0] * 28, 168 + v[1] * 28), 1, PROP)
    c.seg((82, 168), C, 4, PROP); c.seg(C, (168, 124), 4, PROP); c.seg((168, 124), (182, 168), 4, PROP)
    c.seg((96, 122), (96, 142), 4, PROP); c.rect(86, 116, 112, 124, (90, 90, 90), 3); c.seg(C, (96, 142), 4, PROP)
    c.seg((158, 108), (170, 126), 4, PROP); c.seg((152, 108), (166, 108), 5, PROP)
    figure(c, P)
    c.dot(C, 4, PROP)
    for i in range(3):
        x = (i * 100 - u * 100) % 300 - 30
        c.rect(x, FLOOR + 10, x + 26, FLOOR + 13, (160, 196, 196))


@ex('swimming', 32, 70)
def _(c, u):
    th = 360 * u
    kick = math.sin(math.radians(th * 3))
    P = dict(hip=(96, 140), tr=90, thN=-90 + 7 * kick, shN=-90 + 12 * kick, thF=-90 - 7 * kick, shF=-90 - 12 * kick,
             uaN=th + 180, faN=th + 180, uaF=th, faF=th, nk=48, hl=('armN',))
    c.rect(0, 0, W, W, BG)
    figure(c, P)
    c.rect(0, 150, W, W, (92, 184, 224, 120))                                    # water over the body
    for i in range(-12, W, 24):
        c.seg((i, 150), (i + 12, 146), 3, (255, 255, 255, 210))
    c.arrow((200, 196), (226, 196), ICE)


@ex('ice-compression', 28, 90)
def _(c, u):
    a = lying(anN=(190, 197), anF=(190, 197), ftN=180, ftF=180, hl=('legN',))
    floor(c); bed(c); figure(c, a)
    k = 0.5 + 0.5 * math.sin(2 * math.pi * u)
    c.rect(134, 183, 160, 195, ICE, 4)                                          # ice pack with a wrap
    c.rect(130, 181, 135, 197, (240, 240, 240)); c.rect(159, 181, 164, 197, (240, 240, 240))
    snow(c, (147, 189), 5, (255, 255, 255))
    c.arrow((147, 150 + 6 * k), (147, 176))
    for i in range(3):
        v = (u * 3 + i / 3.0) % 1.0
        snow(c, (126 + i * 22, 168 - 18 * v), 5 * (1 - v) + 1, ICE)


@ex('ice-elevation', 28, 90)
def _(c, u):
    a = lying(anN=(188, 160), anF=(188, 160), ftN=180, ftF=180, hl=('legN',))
    a['anN'] = (184, 150); a['anF'] = (184, 150)
    floor(c); bed(c)
    c.poly([(128, 200), (212, 200), (212, 168), (128, 196)], (244, 244, 244))   # pillows
    figure(c, a)
    k = 0.5 + 0.5 * math.sin(2 * math.pi * u)
    c.rect(137, 168, 160, 182, ICE, 4); snow(c, (148, 175), 5, (255, 255, 255))
    c.arrow((220, 190), (220, 150 - 4 * k))
    for i in range(3):
        v = (u * 3 + i / 3.0) % 1.0
        snow(c, (120 + i * 24, 150 - 20 * v), 5 * (1 - v) + 1, ICE)


# ---------------------------------------------------------------- output
def render(name, out_dir):
    fn, frames, ms = EX[name]
    imgs = []
    for i in range(frames):
        c = Canvas()
        fn(c, i / frames)
        imgs.append(c.done())
    pal = imgs[0].convert('P', palette=Image.ADAPTIVE, colors=48)
    ps = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im in imgs]
    path = os.path.join(out_dir, f'{name}.gif')
    ps[0].save(path, save_all=True, append_images=ps[1:], duration=ms, loop=0, optimize=True, disposal=1)
    return path, imgs


def main():
    args = sys.argv[1:]
    sheet = None
    if '--sheet' in args:
        i = args.index('--sheet'); sheet = args[i + 1]; del args[i:i + 2]
    names = args or sorted(EX)
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'media', 'gif')
    os.makedirs(out_dir, exist_ok=True)
    tiles = []
    for n in names:
        path, imgs = render(n, out_dir)
        print(f'{n}: {os.path.getsize(path) // 1024} KB')
        tiles.append((n, [imgs[0], imgs[len(imgs) // 3], imgs[len(imgs) * 2 // 3]]))
    if sheet:
        cols = 2
        rows = (len(tiles) + cols - 1) // cols
        S = 150
        im = Image.new('RGB', (cols * 3 * S, rows * (S + 14)), (255, 255, 255))
        dr = ImageDraw.Draw(im)
        for k, (n, fr) in enumerate(tiles):
            x0, y0 = (k % cols) * 3 * S, (k // cols) * (S + 14)
            dr.text((x0 + 3, y0 + 1), n, fill=(0, 0, 0))
            for j, f in enumerate(fr):
                im.paste(f.resize((S, S)), (x0 + j * S, y0 + 14))
        im.save(sheet)


if __name__ == '__main__':
    main()
