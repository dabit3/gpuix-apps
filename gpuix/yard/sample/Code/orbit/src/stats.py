"""Rolling latency statistics for Orbit job runs."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from statistics import quantiles


@dataclass
class Rolling:
    window: int = 512
    samples: deque[float] = field(default_factory=deque)

    def push(self, ms: float) -> None:
        self.samples.append(ms)
        if len(self.samples) > self.window:
            self.samples.popleft()

    def summary(self) -> dict[str, float]:
        if len(self.samples) < 2:
            return {"count": len(self.samples)}
        p50, p90, p99 = (quantiles(self.samples, n=100)[i] for i in (49, 89, 98))
        return {"count": len(self.samples), "p50": p50, "p90": p90, "p99": p99}


if __name__ == "__main__":
    r = Rolling()
    for ms in (12.0, 15.5, 9.8, 31.2, 14.1, 11.7):
        r.push(ms)
    print(r.summary())
