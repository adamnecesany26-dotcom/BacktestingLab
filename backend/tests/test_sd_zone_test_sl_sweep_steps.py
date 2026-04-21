import math

from backend.app.api.sd_zone_test import SlMultRange


def test_sl_mult_range_validates_basic() -> None:
    r = SlMultRange(min=0.5, max=1.1)
    assert math.isfinite(r.min)
    assert math.isfinite(r.max)

