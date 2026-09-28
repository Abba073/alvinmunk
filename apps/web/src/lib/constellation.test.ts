import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RepEvent } from './events';

const { getCountsMock, fetchEventsMock } = vi.hoisted(() => ({
  getCountsMock: vi.fn(),
  fetchEventsMock: vi.fn(),
}));

vi.mock('./reputation', () => ({ getCounts: getCountsMock, getVouch: vi.fn() }));
vi.mock('./events', () => ({ fetchReputationEvents: fetchEventsMock }));

import { addrHue, countPeopleInEvents, getPeopleCounts, timeAgo } from './constellation';

const NOW = Math.floor(Date.now() / 1000);

describe('addrHue', () => {
  it('is deterministic for the same address', () => {
    const a = 'G'.padEnd(56, 'A');
    expect(addrHue(a)).toBe(addrHue(a));
  });

  it('stays within the 0-359 hue range', () => {
    for (const a of ['', 'G'.padEnd(56, 'A'), 'G'.padEnd(56, 'B'), 'short']) {
      const h = addrHue(a);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('differs for different addresses', () => {
    expect(addrHue('G'.padEnd(56, 'A'))).not.toBe(addrHue('G'.padEnd(56, 'B')));
  });
});

describe('timeAgo', () => {
  it('returns empty for a falsy timestamp', () => {
    expect(timeAgo(0)).toBe('');
  });

  it('reads recent times warmly', () => {
    expect(timeAgo(NOW)).toBe('today');
    expect(timeAgo(NOW - 86_400)).toBe('yesterday');
    expect(timeAgo(NOW - 3 * 86_400)).toBe('3 days ago');
  });

  it('rolls up into weeks and months', () => {
    expect(timeAgo(NOW - 14 * 86_400)).toBe('2 weeks ago');
    expect(timeAgo(NOW - 7 * 86_400)).toBe('1 week ago');
    expect(timeAgo(NOW - 60 * 86_400)).toBe('2 months ago');
  });
});

const ME = 'G'.padEnd(56, 'M');
const A = 'G'.padEnd(56, 'A');
const B = 'G'.padEnd(56, 'B');
const C = 'G'.padEnd(56, 'C');

const claimed = (id: number, from: string, claimer: string): RepEvent => ({
  topics: ['vouch', 'claimed'],
  data: [id, from, claimer],
  ledger: id,
});

describe('countPeopleInEvents', () => {
  it('counts distinct vouchers and distinct people backed, collapsing repeat pairs', () => {
    const events: RepEvent[] = [
      claimed(1, A, ME),
      claimed(2, A, ME), // repeat pair
      claimed(3, B, ME),
      claimed(4, ME, C),
      claimed(5, ME, C), // repeat pair
      claimed(6, A, B), // unrelated edge
    ];
    expect(countPeopleInEvents(events, ME)).toEqual({ vouchedBy: 2, backed: 1 });
  });

  it('ignores other event kinds and malformed payloads', () => {
    const events: RepEvent[] = [
      { topics: ['vouch', 'minted'], data: [1, A], ledger: 1 },
      { topics: ['social', ME], data: [10, 30], ledger: 2 },
      { topics: ['vouch', 'claimed'], data: null, ledger: 3 },
    ];
    expect(countPeopleInEvents(events, ME)).toEqual({ vouchedBy: 0, backed: 0 });
  });
});

describe('getPeopleCounts', () => {
  beforeEach(() => {
    getCountsMock.mockReset();
    fetchEventsMock.mockReset();
  });

  it('uses the on-chain counters without reading events once both are live', async () => {
    getCountsMock.mockResolvedValue({ vouchedBy: 4, backed: 2 });
    expect(await getPeopleCounts(ME)).toEqual({ vouchedBy: 4, backed: 2 });
    expect(fetchEventsMock).not.toHaveBeenCalled();
  });

  it('fills a counter that is still 0 from the recent claim events', async () => {
    getCountsMock.mockResolvedValue({ vouchedBy: 3, backed: 0 });
    fetchEventsMock.mockResolvedValue([claimed(1, ME, A), claimed(2, ME, B), claimed(3, C, ME)]);
    // vouchedBy keeps the durable 3 (not the 1 in the window); backed falls back to 2.
    expect(await getPeopleCounts(ME)).toEqual({ vouchedBy: 3, backed: 2 });
  });

  it('falls back to events when the deployed contract has no get_counts', async () => {
    getCountsMock.mockResolvedValue(null);
    fetchEventsMock.mockResolvedValue([claimed(1, A, ME), claimed(2, B, ME), claimed(3, ME, C)]);
    expect(await getPeopleCounts(ME)).toEqual({ vouchedBy: 2, backed: 1 });
  });

  it('reads 0 for a wallet with no vouches anywhere', async () => {
    getCountsMock.mockResolvedValue({ vouchedBy: 0, backed: 0 });
    fetchEventsMock.mockResolvedValue([]);
    expect(await getPeopleCounts(ME)).toEqual({ vouchedBy: 0, backed: 0 });
  });
});
