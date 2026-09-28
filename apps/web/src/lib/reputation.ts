/**
 * Typed Reputation contract client — the Yellow-belt vouch loop with a CLAIM-SECRET.
 *
 * You vouch by minting a half-card bound to sha256(secret) — WITHOUT knowing the
 * recipient's address. The share link carries the secret; the recipient binds their
 * own address at claim time. This is the cold-start fix (belts/00-strategy §3).
 */
import { invokeAndWait, readContract, readPublic, args, repId, questId } from './contracts';
import { shareInFlight } from './utils';
import type { Wallet } from './wallet';

/** Vouch TTL — claim within this window to refund the voucher's stake (mirrors the
 *  contract's VOUCH_TTL_SECS). After it, the stake is slashed but the card still claims. */
export const VOUCH_TTL_SECS = 604_800; // 7 days

/** A half-card as read from chain (the fields the claim funnel surfaces). */
export interface VouchView {
  id: number;
  from: string;
  note: string;
  claimed: boolean;
  claimer: string | null;
  /** ledger unix-seconds when the half-card was minted */
  created: number;
  /** Social XP the voucher escrowed (refunded on a timely claim, else slashed) */
  stake: number;
  slashed: boolean;
}

/** Aggregate profile shape from the on-chain get_profile view. */
export interface ProfileView {
  social: number;
  earned: number;
  verified: boolean;
  /** Distinct people who vouched FOR this address (on-chain counter, first-pair only).
   *  Zero for pre-upgrade wallets that have not yet received a new vouch. */
  vouchedBy: number;
  /** Distinct people this address has vouched / backed (on-chain counter, first-pair only).
   *  Zero for pre-upgrade wallets that have not yet given a new vouch. */
  backed: number;
}

const pendingProfiles = new Map<string, Promise<ProfileView>>();

/** `get_profile(addr)` — single round-trip for social + earned + verified + people counts.
 *  Widgets that mount together (profile header + badge row, stat strip + badge row) share
 *  one read. */
export function getProfile(address: string): Promise<ProfileView> {
  return shareInFlight(pendingProfiles, address, async () => {
    const p = await readPublic<{
      social: bigint;
      earned: bigint;
      verified: boolean;
      vouched_by: number;
      backed: number;
    } | undefined>(
      repId(),
      'get_profile',
      [args.addr(address)],
    );
    return {
      social: Number(p?.social ?? 0),
      earned: Number(p?.earned ?? 0),
      verified: Boolean(p?.verified ?? false),
      vouchedBy: Number(p?.vouched_by ?? 0),
      backed: Number(p?.backed ?? 0),
    };
  });
}

/** `get_counts(addr)` — on-chain people counts without the full profile.
 *  Returns [vouchedBy, backed]. Counters start at the upgrade ledger; pre-upgrade
 *  wallets return 0 until they receive or give a new first-pair vouch.
 */
export async function getCounts(address: string): Promise<{ vouchedBy: number; backed: number }> {
  try {
    const result = await readPublic<readonly [number, number] | undefined>(
      repId(),
      'get_counts',
      [args.addr(address)],
    );
    return {
      vouchedBy: Number(result?.[0] ?? 0),
      backed: Number(result?.[1] ?? 0),
    };
  } catch {
    return { vouchedBy: 0, backed: 0 };
  }
}

// ── client-side crypto for the claim secret ──
function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const h = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return new Uint8Array(h);
}
export function toHex(u8: Uint8Array): string {
  return [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function fromHex(hex: string): Uint8Array {
  const m = hex.match(/.{2}/g) ?? [];
  return new Uint8Array(m.map((x) => parseInt(x, 16)));
}

/** Mint a half-card. Returns the vouch id AND the secret to embed in the share link. */
export async function mintVouch(
  wallet: Wallet,
  note: string,
): Promise<{ id: number; secret: string }> {
  const secret = randomBytes(32);
  const claimHash = await sha256(secret);
  const id = await invokeAndWait<bigint>(
    repId(),
    'mint_vouch',
    [args.addr(wallet.address), args.bytes(claimHash), args.str(note)],
    wallet,
  );
  return { id: Number(id), secret: toHex(secret) };
}

/** Claim a half-card by presenting the secret from the link. Both sides earn Social XP. */
export async function claimVouch(wallet: Wallet, vouchId: number, secretHex: string): Promise<void> {
  await invokeAndWait(
    repId(),
    'claim_vouch',
    [args.addr(wallet.address), args.u64(vouchId), args.bytes(fromHex(secretHex))],
    wallet,
  );
}

/** Read a half-card by id (no wallet needed — used by the logged-out claim funnel). */
export async function getVouch(vouchId: number): Promise<VouchView | null> {
  const v = await readPublic<{
    id: bigint;
    from: string;
    note: string;
    claimed: boolean;
    claimer: string | null;
    created: bigint;
    stake: bigint;
    slashed: boolean;
  } | null>(repId(), 'get_vouch', [args.u64(vouchId)]);
  if (!v) return null;
  return {
    id: Number(v.id),
    from: v.from,
    note: v.note,
    claimed: v.claimed,
    claimer: v.claimer ?? null,
    created: Number(v.created),
    stake: Number(v.stake),
    slashed: v.slashed,
  };
}

/** Wallet-free profile aggregator — social + earned + people counts for ANY address.
 *  Prefers the single-call get_profile view; falls back to the two parallel legacy
 *  calls (+ get_counts) if the deployed contract predates get_profile. */
export async function getScores(address: string): Promise<{ social: number; earned: number; vouchedBy: number; backed: number }> {
  try {
    const p = await getProfile(address);
    return { social: p.social, earned: p.earned, vouchedBy: p.vouchedBy, backed: p.backed };
  } catch {
    const [[s, e], counts] = await Promise.all([
      Promise.all([
        readPublic<bigint>(repId(), 'get_score', [args.addr(address)]).catch(() => 0n),
        readPublic<bigint>(repId(), 'get_earned', [args.addr(address)]).catch(() => 0n),
      ]),
      getCounts(address),
    ]);
    return { social: Number(s ?? 0), earned: Number(e ?? 0), vouchedBy: counts.vouchedBy, backed: counts.backed };
  }
}

/** `get_score(addr)` — Social XP (leaderboard, non-cashable). */
export async function getSocialScore(addr: string, source: string): Promise<number> {
  const v = await readContract<bigint>(repId(), 'get_score', [args.addr(addr)], source);
  return Number(v ?? 0);
}

/** `get_earned(addr)` — Earned XP (the only USDC-eligible track). */
export async function getEarnedScore(addr: string, source: string): Promise<number> {
  const v = await readContract<bigint>(repId(), 'get_earned', [args.addr(addr)], source);
  return Number(v ?? 0);
}

/** `get_attestation(addr)` — Read completed quest attestations for an address. */
export async function getAttestation(addr: string): Promise<number> {
  try {
    const v = await readPublic<bigint>(questId(), 'get_completed', [args.addr(addr)]);
    return Number(v ?? 0);
  } catch {
    return 0;
  }
}

// ── Owed bonuses (issue #275) ─────────────────────────────────────────────────

/** One pending bonus entry owed to `me` for a specific claimer. */
export interface OwedBonus {
  /** Address of the claimer whose verification will release this bonus. */
  claimer: string;
  /** Note on the original vouch (for display). */
  note: string;
  /** Total Social XP owed to `me` from this claimer (sum of all pending entries for me). */
  amount: number;
}

/**
 * `getOwedBonuses(me)` — scan the locally-stored vouches minted by `me`, find the
 * ones that have been claimed but whose claimer hasn't verified yet, and return the
 * pending Social XP owed per claimer.
 *
 * Algorithm:
 * 1. Load `me`'s minted vouches from localStorage (`getMyVouches`).
 * 2. For each, fetch `get_vouch(id)` to find the claimer (skip unclaimed / slashed).
 * 3. Call `get_pending(claimer)` on-chain; keep entries where `voucher == me`.
 * 4. Sum per claimer and return, sorted by amount descending.
 *
 * Skips claimers that are already verified (their Pending was flushed on first
 * Earned action, so `get_pending` returns [] for them).
 */
export async function getOwedBonuses(me: string): Promise<OwedBonus[]> {
  const { getMyVouches } = await import('./myvouches');
  const mine = getMyVouches();
  if (mine.length === 0) return [];

  // Fetch chain state for all stored vouches in parallel.
  const settled = await Promise.all(
    mine.map(async (mv) => {
      const v = await getVouch(mv.id).catch(() => null);
      // Only care about claimed vouches — unclaimed means the bonus hasn't been queued.
      if (!v || !v.claimed || !v.claimer) return null;
      return { claimer: v.claimer, note: mv.note };
    }),
  );

  // Deduplicate claimers (same person may have claimed multiple vouches from me).
  const claimerMap = new Map<string, string>(); // claimer -> note (first vouch note wins)
  for (const s of settled) {
    if (!s) continue;
    if (!claimerMap.has(s.claimer)) claimerMap.set(s.claimer, s.note);
  }
  if (claimerMap.size === 0) return [];

  // For each unique claimer, read their pending bonus list on-chain.
  const results: OwedBonus[] = [];
  await Promise.all(
    Array.from(claimerMap.entries()).map(async ([claimer, note]) => {
      try {
        const pending = await readPublic<Array<{ voucher: string; amount: bigint }>>(
          repId(),
          'get_pending',
          [args.addr(claimer)],
        );
        if (!pending || pending.length === 0) return; // already verified — nothing owed
        const total = pending
          .filter((p) => p.voucher === me)
          .reduce((sum, p) => sum + Number(p.amount), 0);
        if (total > 0) results.push({ claimer, note, amount: total });
      } catch {
        // RPC miss — skip this claimer silently
      }
    }),
  );

  return results.sort((a, b) => b.amount - a.amount);
}
