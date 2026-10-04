import { describe, expect, it } from 'vitest';
import { DAY, moonAt, START_MINUTE, SYNODIC } from '../src/poc3d/district/clock';
import { moonTimes } from '../src/poc3d/district/weatherApp';

describe("the weather app's moon", () => {
  it('rises in the evening and sets in the morning when full, and rises about 50 minutes later each day', () => {
    // The first night is a full moon: from noon it next rises about sunset and sets about sunrise.
    const noon = 12 * 60 + DAY;
    const t = moonTimes(moonAt, noon);
    expect(t.rise).not.toBeNull();
    expect(t.set).not.toBeNull();
    const rise = (noon + t.rise!) % DAY;
    const set = (noon + t.set!) % DAY;
    expect(rise).toBeGreaterThan(16 * 60);
    expect(rise).toBeLessThan(20 * 60);
    expect(set).toBeGreaterThan(4 * 60);
    expect(set).toBeLessThan(8 * 60);
    const next = moonTimes(moonAt, noon + DAY);
    const later = ((noon + DAY + next.rise!) % DAY) - rise;
    expect(later).toBeGreaterThan(40);
    expect(later).toBeLessThan(60);
  });

  it('finds a new moon down at night', () => {
    const nu = START_MINUTE + Math.round((SYNODIC / 2) * DAY);
    const midnight = Math.ceil(nu / DAY) * DAY;
    expect(moonAt(midnight).dir[1]).toBeLessThan(0);
    expect(moonTimes(moonAt, midnight).rise).not.toBeNull();
  });
});
