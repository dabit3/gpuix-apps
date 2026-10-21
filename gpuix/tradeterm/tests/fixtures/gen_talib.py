"""Regenerates talib.json: reference indicator values from TA-Lib for tests/indicators.test.ts.

python3 -m venv /tmp/ta && /tmp/ta/bin/pip install numpy TA-Lib   # needs `brew install ta-lib`
/tmp/ta/bin/python tests/fixtures/gen_talib.py
"""
import json, math, os
import numpy as np
import talib

# Deterministic OHLCV series (an LCG random walk), 120 bars.
seed = 7
def rnd():
    global seed
    seed = (seed * 1103515245 + 12345) % 2**31
    return seed / 2**31
o, h, l, c, v = [], [], [], [], []
price = 100.0
for i in range(120):
    op = price
    cl = max(1.0, op * (1 + (rnd() - 0.48) * 0.04))
    hi = max(op, cl) * (1 + rnd() * 0.01)
    lo = min(op, cl) * (1 - rnd() * 0.01)
    o.append(round(op, 4)); h.append(round(hi, 4)); l.append(round(lo, 4)); c.append(round(cl, 4)); v.append(round(1000 + rnd() * 500, 2))
    price = cl
O, H, L, C, V = (np.array(x, dtype=float) for x in (o, h, l, c, v))

def js(a):
    return [None if math.isnan(x) else round(float(x), 10) for x in a]

up, mid, lo_ = talib.BBANDS(C, 20, 2, 2, 0)
m, s, hist = talib.MACD(C, 12, 26, 9)
k, d = talib.STOCH(H, L, C, 14, 1, 0, 3, 0)
out = {
    "talib": talib.__version__,
    "bars": [{"t": 1_700_000_000 + i * 3600, "o": o[i], "h": h[i], "l": l[i], "c": c[i], "v": v[i]} for i in range(len(c))],
    "sma10": js(talib.SMA(C, 10)),
    "ema10": js(talib.EMA(C, 10)),
    "wma10": js(talib.WMA(C, 10)),
    "rsi14": js(talib.RSI(C, 14)),
    "bb20": {"upper": js(up), "mid": js(mid), "lower": js(lo_)},
    "macd": {"line": js(m), "signal": js(s), "hist": js(hist)},
    "atr14": js(talib.ATR(H, L, C, 14)),
    "stoch": {"k": js(k), "d": js(d)},
    "obv": js(talib.OBV(C, V)),
    "donchian20": {"upper": js(talib.MAX(H, 20)), "lower": js(talib.MIN(L, 20))},
}
with open(os.path.join(os.path.dirname(__file__), "talib.json"), "w") as f:
    json.dump(out, f)
print("wrote talib.json with TA-Lib", talib.__version__)
