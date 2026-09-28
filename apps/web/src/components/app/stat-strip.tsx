'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, Users, ShieldCheck } from 'lucide-react';
import { getScores } from '@/lib/reputation';
import { StateArt } from '@/components/ui/state-art';
import { cn } from '@/lib/utils';

/**
 * Dashboard stat strip — the at-a-glance reputation summary that anchors the app shell.
 * Reads both XP tracks + the on-chain people counts for the signed-in address. The
 * "Vouched by" tile is the headline number ("collect people, not points") and is sourced
 * from the durable on-chain VouchedBy counter — not from social/10 or the ~12h event
 * window. Refreshes on mount and on a slow interval so the numbers catch up after a
 * vouch / claim / quest without a full reload.
 */
const REFRESH_MS = 15_000;

type Tile = {
  key: 'vouchedBy' | 'backed' | 'earned';
  label: string;
  hint: string;
  icon: typeof Sparkles;
  tint: string;
};

const TILES: Tile[] = [
  { key: 'vouchedBy', label: 'Vouched by', hint: 'People in your sky', icon: Sparkles, tint: 'text-accent' },
  { key: 'backed', label: 'Backed', hint: 'People you vouched', icon: Users, tint: 'text-tertiary' },
  { key: 'earned', label: 'Earned XP', hint: 'Verified · unlocks USDC', icon: ShieldCheck, tint: 'text-secondary' },
];

export function StatStrip({ address }: { address: string }) {
  const [scores, setScores] = useState<{ social: number; earned: number; vouchedBy: number; backed: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => {
      setLoading(true);
      getScores(address)
        .then((s) => {
          if (alive) {
            setScores(s);
            setLoading(false);
          }
        })
        .catch(() => {
          if (alive) {
            setScores({ social: 0, earned: 0, vouchedBy: 0, backed: 0 });
            setLoading(false);
          }
        });
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [address]);

  // Real on-chain people counts. Falls back to social/10 approximation only for
  // pre-upgrade wallets where vouchedBy is still 0.
  const vouchedBy = scores
    ? scores.vouchedBy > 0
      ? scores.vouchedBy
      : Math.max(0, Math.round(scores.social / 10))
    : 0;
  const value = (k: Tile['key']) =>
    k === 'vouchedBy' ? vouchedBy : k === 'backed' ? (scores?.backed ?? 0) : (scores?.earned ?? 0);
  const hasAnySignal = vouchedBy > 0 || (scores?.backed ?? 0) > 0 || (scores?.earned ?? 0) > 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {loading
          ? TILES.map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.key} className="glass rounded-2xl p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Icon className={cn('size-4', t.tint)} />
                    <span className="text-xs font-medium text-muted-foreground">{t.label}</span>
                  </div>
                  <div className="h-9 w-16 animate-pulse rounded bg-muted/40" />
                  <div className="mt-2 h-2 w-20 animate-pulse rounded bg-muted/30" />
                </div>
              );
            })
          : TILES.map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.key} className="glass rounded-2xl p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Icon className={cn('size-4', t.tint)} />
                    <span className="text-xs font-medium text-muted-foreground">{t.label}</span>
                  </div>
                  <div className="font-display text-3xl font-semibold tabular-nums">
                    {value(t.key).toLocaleString('en-US')}
                  </div>
                  <p className="mt-1 hidden text-[11px] text-muted-foreground/70 sm:block">{t.hint}</p>
                </div>
              );
            })}
      </div>

      {!loading && !hasAnySignal && (
        <div className="glass rounded-2xl border border-dashed border-primary/30 p-4">
          <div className="flex items-start gap-3">
            <StateArt kind="empty-leaderboard" size={96} className="shrink-0" />
            <div>
              <p className="font-display text-lg text-foreground">Your constellation is still quiet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The first vouch, quest, or tip lights up your reputation trail and turns this strip into a living résumé.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
