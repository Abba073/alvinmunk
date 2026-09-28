/**
 * Unit tests for getOwedBonuses() — mocks the chain reads and localStorage vouches
 * so the logic can be exercised without a live RPC connection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock ./contracts ──────────────────────────────────────────────────────────
const readPublicMock = vi.fn();

vi.mock('./contracts', () => ({
  repId: () => 'CREPID',
  questId: () => 'CQUESTID',
  readPublic: (...a: unknown[]) => readPublicMock(...a),
  readContract: vi.fn(),
  invokeAndWait: vi.fn(),
  args: {
    addr: (g: string) => ({ __addr: g }),
    u64: (n: number) => ({ __u64: n }),
    str: (s: string) => ({ __str: s }),
    bytes: (b: Uint8Array) => ({ __bytes: b }),
  },
}));

// ── mock ./myvouches ──────────────────────────────────────────────────────────
const getMyVouchesMock = vi.fn();
vi.mock('./myvouches', () => ({
  getMyVouches: (...a: unknown[]) => getMyVouchesMock(...a),
}));

import { getOwedBonuses } from './reputation';

const ME = 'GMEADDRESS000000000000000000000000000000000000000000000000';
const BOB_CLAIMER = 'GBOBCLAIMER00000000000000000000000000000000000000000000000';
const EVE_CLAIMER = 'GEVECLAIMER00000000000000000000000000000000000000000000000';

/** Build a minimal VouchView-like object as returned by get_vouch via readPublic. */
function vouchResult(claimer: string | null, opts: { slashed?: boolean } = {}) {
  return {
    id: 1n,
    from: ME,
    note: 'helped me',
    claimed: claimer !== null,
    claimer: claimer ?? null,
    created: 0n,
    stake: 5n,
    slashed: opts.slashed ?? false,
  };
}

describe('getOwedBonuses', () => {
  beforeEach(() => {
    readPublicMock.mockReset();
    getMyVouchesMock.mockReset();
  });

  it('returns empty array when user has no stored vouches', async () => {
    getMyVouchesMock.mockReturnValue([]);
    const result = await getOwedBonuses(ME);
    expect(result).toEqual([]);
    expect(readPublicMock).not.toHaveBeenCalled();
  });

  it('returns empty array when all vouches are unclaimed', async () => {
    getMyVouchesMock.mockReturnValue([{ id: 1, secret: 'x', note: 'hey', created: 0 }]);
    // get_vouch returns unclaimed vouch
    readPublicMock.mockResolvedValueOnce(vouchResult(null));
    const result = await getOwedBonuses(ME);
    expect(result).toEqual([]);
  });

  it('returns owed bonus when claimer has a pending entry for me', async () => {
    getMyVouchesMock.mockReturnValue([{ id: 1, secret: 'x', note: 'helped me', created: 0 }]);
    // get_vouch call → claimed by BOB
    readPublicMock.mockResolvedValueOnce(vouchResult(BOB_CLAIMER));
    // get_pending(BOB_CLAIMER) → one entry owed to ME
    readPublicMock.mockResolvedValueOnce([{ voucher: ME, amount: 5n }]);

    const result = await getOwedBonuses(ME);
    expect(result).toEqual([{ claimer: BOB_CLAIMER, note: 'helped me', amount: 5 }]);
  });

  it('returns empty array when claimer has already verified (empty pending list)', async () => {
    getMyVouchesMock.mockReturnValue([{ id: 1, secret: 'x', note: 'note', created: 0 }]);
    readPublicMock.mockResolvedValueOnce(vouchResult(BOB_CLAIMER));
    // get_pending returns empty — claimer already verified and bonuses were released
    readPublicMock.mockResolvedValueOnce([]);

    const result = await getOwedBonuses(ME);
    expect(result).toEqual([]);
  });

  it('excludes pending entries from other vouchers, only counting mine', async () => {
    getMyVouchesMock.mockReturnValue([{ id: 1, secret: 'x', note: 'note', created: 0 }]);
    readPublicMock.mockResolvedValueOnce(vouchResult(BOB_CLAIMER));
    // get_pending has two entries: one from ME and one from someone else
    readPublicMock.mockResolvedValueOnce([
      { voucher: ME, amount: 5n },
      { voucher: 'GSOMEONEELSE', amount: 5n },
    ]);

    const result = await getOwedBonuses(ME);
    expect(result).toEqual([{ claimer: BOB_CLAIMER, note: 'helped me', amount: 5 }]);
  });

  it('sums multiple pending entries for the same claimer across different vouches', async () => {
    getMyVouchesMock.mockReturnValue([
      { id: 1, secret: 'a', note: 'first vouch', created: 0 },
      { id: 2, secret: 'b', note: 'second vouch', created: 1 },
    ]);
    // Both vouches claimed by the same BOB
    readPublicMock.mockResolvedValueOnce(vouchResult(BOB_CLAIMER)); // vouch 1
    readPublicMock.mockResolvedValueOnce(vouchResult(BOB_CLAIMER)); // vouch 2
    // get_pending(BOB_CLAIMER) — two entries for me (one per vouch that queued a bonus)
    readPublicMock.mockResolvedValueOnce([
      { voucher: ME, amount: 5n },
      { voucher: ME, amount: 5n },
    ]);

    const result = await getOwedBonuses(ME);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(10);
    expect(result[0].claimer).toBe(BOB_CLAIMER);
  });

  it('returns multiple rows when different claimers each owe a bonus', async () => {
    getMyVouchesMock.mockReturnValue([
      { id: 1, secret: 'a', note: 'vouch bob', created: 0 },
      { id: 2, secret: 'b', note: 'vouch eve', created: 1 },
    ]);
    readPublicMock.mockResolvedValueOnce(vouchResult(BOB_CLAIMER)); // vouch 1
    readPublicMock.mockResolvedValueOnce(vouchResult(EVE_CLAIMER)); // vouch 2
    readPublicMock.mockResolvedValueOnce([{ voucher: ME, amount: 5n }]); // get_pending(BOB)
    readPublicMock.mockResolvedValueOnce([{ voucher: ME, amount: 5n }]); // get_pending(EVE)

    const result = await getOwedBonuses(ME);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.amount === 5)).toBe(true);
  });

  it('sorts results by amount descending', async () => {
    getMyVouchesMock.mockReturnValue([
      { id: 1, secret: 'a', note: 'vouch bob', created: 0 },
      { id: 2, secret: 'b', note: 'vouch eve', created: 1 },
    ]);
    readPublicMock.mockResolvedValueOnce(vouchResult(BOB_CLAIMER));
    readPublicMock.mockResolvedValueOnce(vouchResult(EVE_CLAIMER));
    // BOB owes 5, EVE owes 10 → EVE should come first
    readPublicMock.mockResolvedValueOnce([{ voucher: ME, amount: 5n }]);  // get_pending(BOB)
    readPublicMock.mockResolvedValueOnce([{ voucher: ME, amount: 10n }]); // get_pending(EVE)

    const result = await getOwedBonuses(ME);
    expect(result[0].claimer).toBe(EVE_CLAIMER);
    expect(result[0].amount).toBe(10);
    expect(result[1].claimer).toBe(BOB_CLAIMER);
    expect(result[1].amount).toBe(5);
  });

  it('skips a claimer gracefully when get_pending throws an RPC error', async () => {
    getMyVouchesMock.mockReturnValue([{ id: 1, secret: 'x', note: 'note', created: 0 }]);
    readPublicMock.mockResolvedValueOnce(vouchResult(BOB_CLAIMER));
    readPublicMock.mockRejectedValueOnce(new Error('RPC timeout'));

    const result = await getOwedBonuses(ME);
    expect(result).toEqual([]);
  });
});
