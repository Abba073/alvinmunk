'use client';

import React, { useEffect, useState } from 'react';
import { Copy, Check, Sparkles } from 'lucide-react';
import { getOwedBonuses, type OwedBonus } from '@/lib/reputation';
import { useWallet } from '@/components/wallet/wallet-provider';
import { Frame } from '@/components/fx/frame';
import { Sticker } from '@/components/ui/sticker';
import { buttonVariants } from '@/components/ui/button';
import { useTranslations } from '@/lib/i18n';
import { FOCUS_MODE } from '@/lib/focus';
import { cn, shortAddress } from '@/lib/utils';

/**
 * OwedBonuses — the bonus Social XP you'll earn once the people you vouched become
 * verified. Turns the hidden anti-sybil 2nd-order gate into a cooperative mechanic:
 * you can see what's waiting and nudge each person to complete a quest.
 *
 * Self-hides when the owed list is empty.
 * Under FOCUS_MODE the quests link is replaced by a plain-text nudge.
 */

const QUESTS_PATH = '/app/quests';

function buildShareText(origin: string): string {
  return `${origin}${QUESTS_PATH}`;
}

export function OwedBonuses() {
  const { profile } = useWallet();
  const t = useTranslations();
  const [items, setItems] = useState<OwedBonus[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null); // claimer address

  useEffect(() => {
    if (!profile?.address) return;
    getOwedBonuses(profile.address)
      .then(setItems)
      .catch(() => setItems([]));
  }, [profile?.address]);

  // Still loading or no address yet
  if (items === null) {
    return (
      <Frame label={t('owedBonuses.frameLabel')} index="…" accent="secondary">
        <div className="space-y-2 p-4">
          <div className="h-3 w-32 animate-pulse rounded bg-muted/40" />
          <div className="h-10 animate-pulse rounded-xl bg-muted/30" />
        </div>
      </Frame>
    );
  }

  // Nothing owed — self-hide
  if (items.length === 0) return null;

  const total = items.reduce((sum, r) => sum + r.amount, 0);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  async function handleNudge(claimer: string) {
    const link = buildShareText(origin);
    try {
      if (!FOCUS_MODE && navigator.share) {
        await navigator.share({ title: 'Earn verified XP on alvinmunk', url: link });
      } else {
        await navigator.clipboard.writeText(link);
        setCopied(claimer);
        setTimeout(() => setCopied(null), 1500);
      }
    } catch {
      // share/clipboard unavailable — silently ignore
    }
  }

  return (
    <Frame
      label={t('owedBonuses.frameLabel')}
      index={String(items.length).padStart(2, '0')}
      accent="secondary"
      tape="tr"
    >
      <Sticker name="stamp-verified" size={56} rotate={6} className="absolute -bottom-2 right-3 z-10 opacity-80" />

      {/* Header */}
      <div className="flex items-start gap-3 p-4 pb-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-secondary" />
        <div>
          <p className="font-display text-lg text-foreground">
            {t('owedBonuses.title', { total: String(total) })}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('owedBonuses.subtitle')}</p>
        </div>
      </div>

      {/* Rows */}
      <ul className="divide-y divide-border/50">
        {items.map((row) => {
          const isCopied = copied === row.claimer;
          return (
            <li key={row.claimer} className="flex items-center gap-3 p-4">
              {/* XP amount badge */}
              <div className="grid size-10 shrink-0 place-items-center border border-dashed border-secondary/50 text-secondary">
                <span className="font-mono text-[10px]">+{row.amount}</span>
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm italic text-foreground/85">&ldquo;{row.note}&rdquo;</p>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {shortAddress(row.claimer)} · {t('owedBonuses.rowHint')}
                </p>
              </div>

              {/* Nudge button */}
              {FOCUS_MODE ? (
                <span className="shrink-0 text-xs text-muted-foreground italic">
                  {t('owedBonuses.nudgeFocus')}
                </span>
              ) : (
                <button
                  onClick={() => handleNudge(row.claimer)}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'glass shrink-0 font-mono')}
                  aria-label={`Share quests link with ${shortAddress(row.claimer)}`}
                >
                  {isCopied ? (
                    <>
                      <Check className="size-4" />
                      {t('owedBonuses.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="size-4" />
                      {t('owedBonuses.nudge')}
                    </>
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Frame>
  );
}
