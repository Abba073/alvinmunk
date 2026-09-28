/**
 * Username registry client — on-chain handle ↔ address. Turns @handle into a public,
 * shareable identity that resolves for ANY wallet (not just the logged-in user).
 * Validate/normalize the handle with normalizeHandle() BEFORE calling claim.
 */
import { invokeAndWait, readPublic, args, registryId } from './contracts';
import type { Wallet } from './wallet';
import type { AvatarConfig } from './avatar';
import { encodeAvatar, decodeAvatar } from './avatar';

/** Resolve `@handle` → address (public, wallet-free). null if unclaimed/unconfigured. */
export async function resolveHandle(handle: string): Promise<string | null> {
  if (!registryId() || !handle) return null;
  const v = await readPublic<string | null>(registryId(), 'resolve', [args.sym(handle)]).catch(
    () => null,
  );
  return v ?? null;
}

/** Reverse address → `@handle`. null if the address hasn't claimed one. */
export async function reverseHandle(address: string): Promise<string | null> {
  if (!registryId() || !address) return null;
  const v = await readPublic<string | null>(registryId(), 'reverse', [args.addr(address)]).catch(
    () => null,
  );
  return v ?? null;
}

/** Is this handle free to claim? */
export async function isHandleAvailable(handle: string): Promise<boolean> {
  return (await resolveHandle(handle)) === null;
}

/** Claim `@handle` on-chain (first-come; renames if the wallet already holds one). */
export async function claimHandle(wallet: Wallet, handle: string): Promise<void> {
  await invokeAndWait(
    registryId(),
    'claim',
    [args.addr(wallet.address), args.sym(handle)],
    wallet,
  );
}

/** On-chain profile metadata as returned by `get_meta`. */
export interface OnChainMeta {
  avatar: AvatarConfig;
  bio: string;
}

/**
 * Write avatar + bio on-chain. Requires the wallet to already hold a handle.
 * `avatar` is packed into a u64 via `encodeAvatar`.
 */
export async function setMeta(wallet: Wallet, avatar: AvatarConfig, bio: string): Promise<void> {
  const packed = encodeAvatar(avatar);
  await invokeAndWait(
    registryId(),
    'set_meta',
    [args.addr(wallet.address), args.u64(packed), args.str(bio)],
    wallet,
  );
}

/**
 * Read on-chain profile meta for any address. Returns null when not set or on error.
 * This is a public read — no wallet required.
 */
export async function getMeta(address: string): Promise<OnChainMeta | null> {
  if (!registryId() || !address) return null;
  try {
    const raw = await readPublic<{ avatar: bigint; bio: string } | null>(
      registryId(),
      'get_meta',
      [args.addr(address)],
    );
    if (!raw) return null;
    return {
      avatar: decodeAvatar(raw.avatar),
      bio: raw.bio,
    };
  } catch {
    return null;
  }
}
