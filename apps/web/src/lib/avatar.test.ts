import { describe, it, expect } from 'vitest';
import {
  FACE_IDS,
  defaultAvatarId,
  resolveAvatarId,
  isFaceId,
  faceSrc,
  faceFile,
  defaultKit,
  kitSrc,
  KIT_COUNTS,
  KIT_LAYERS,
  encodeAvatar,
  decodeAvatar,
  type AvatarConfig,
} from './avatar';

const A = 'G'.padEnd(56, 'A');
const B = 'G'.padEnd(56, 'B');

describe('defaultAvatarId', () => {
  it('is deterministic for the same address', () => {
    expect(defaultAvatarId(A)).toBe(defaultAvatarId(A));
  });

  it('always resolves to a real face id', () => {
    for (const addr of [A, B, '', 'short', 'G'.padEnd(56, 'Z')]) {
      expect(FACE_IDS).toContain(defaultAvatarId(addr));
    }
  });

  it('spreads addresses across the face set', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(defaultAvatarId(`G${i}`.padEnd(56, 'X')));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('resolveAvatarId', () => {
  it('honors a valid explicit choice', () => {
    expect(resolveAvatarId({ kind: 'face', id: 'face-04' }, A)).toBe('face-04');
  });

  it('falls back to the deterministic default when unset', () => {
    expect(resolveAvatarId(undefined, A)).toBe(defaultAvatarId(A));
  });

  it('ignores an invalid stored id', () => {
    expect(resolveAvatarId({ kind: 'face', id: 'face-99' as never }, A)).toBe(defaultAvatarId(A));
  });
});

describe('face helpers', () => {
  it('validates face ids', () => {
    expect(isFaceId('face-01')).toBe(true);
    expect(isFaceId('nope')).toBe(false);
  });

  it('builds public src and repo-relative file paths', () => {
    expect(faceSrc('face-02')).toBe('/assets/stickers/face-02.png');
    expect(faceFile('face-02')).toBe('stickers/face-02.png');
  });
});

describe('portrait-kit', () => {
  it('defaultKit is deterministic and within bounds', () => {
    const k = defaultKit(A);
    expect(defaultKit(A)).toEqual(k);
    expect(k.skin).toBeGreaterThanOrEqual(1);
    expect(k.skin).toBeLessThanOrEqual(KIT_COUNTS.skin);
    expect(k.eyes).toBeLessThanOrEqual(KIT_COUNTS.eyes);
    expect(k.acc === null || (k.acc >= 1 && k.acc <= KIT_COUNTS.acc)).toBe(true);
  });

  it('kitSrc zero-pads the index and points into portrait-kit', () => {
    expect(kitSrc('skin', 3)).toBe('/assets/portrait-kit/skin/03.png');
    expect(kitSrc('acc', 12)).toBe('/assets/portrait-kit/accessory/12.png');
    expect(kitSrc('bg', 1)).toBe('/assets/portrait-kit/bg/01.png');
  });

  it('every layer maps to a real kit field', () => {
    const fields = new Set(['skin', 'hair', 'eyes', 'mouth', 'acc', 'bg']);
    for (const layer of KIT_LAYERS) {
      expect(fields.has(layer.field as string)).toBe(true);
      expect(layer.wRef).toBeGreaterThan(0);
    }
  });
});

describe('encodeAvatar / decodeAvatar', () => {
  it('round-trips every face id', () => {
    for (const id of FACE_IDS) {
      const cfg: AvatarConfig = { kind: 'face', id };
      expect(decodeAvatar(encodeAvatar(cfg))).toEqual(cfg);
    }
  });

  it('face encoding has kind bit = 0', () => {
    const packed = encodeAvatar({ kind: 'face', id: 'face-01' });
    expect((packed >> 63n) & 1n).toBe(0n);
  });

  it('kit encoding has kind bit = 1', () => {
    const cfg: AvatarConfig = { kind: 'kit', skin: 1, hair: 1, eyes: 1, mouth: 1, acc: null, bg: null };
    const packed = encodeAvatar(cfg);
    expect((packed >> 63n) & 1n).toBe(1n);
  });

  it('round-trips a fully-specified kit avatar', () => {
    const cfg: AvatarConfig = {
      kind: 'kit',
      skin: 3,
      hair: 7,
      eyes: 5,
      mouth: 4,
      acc: 9,
      bg: 2,
    };
    expect(decodeAvatar(encodeAvatar(cfg))).toEqual(cfg);
  });

  it('round-trips kit avatar with null acc and null bg', () => {
    const cfg: AvatarConfig = {
      kind: 'kit',
      skin: 6,
      hair: 10,
      eyes: 10,
      mouth: 9,
      acc: null,
      bg: null,
    };
    expect(decodeAvatar(encodeAvatar(cfg))).toEqual(cfg);
  });

  it('round-trips kit avatar with null acc, non-null bg', () => {
    const cfg: AvatarConfig = {
      kind: 'kit',
      skin: 2,
      hair: 4,
      eyes: 3,
      mouth: 2,
      acc: null,
      bg: 5,
    };
    expect(decodeAvatar(encodeAvatar(cfg))).toEqual(cfg);
  });

  it('round-trips all kit boundary values', () => {
    const cases: AvatarConfig[] = [
      { kind: 'kit', skin: 1, hair: 1, eyes: 1, mouth: 1, acc: 1, bg: 1 },
      { kind: 'kit', skin: KIT_COUNTS.skin, hair: KIT_COUNTS.hair, eyes: KIT_COUNTS.eyes, mouth: KIT_COUNTS.mouth, acc: KIT_COUNTS.acc, bg: KIT_COUNTS.bg },
    ];
    for (const cfg of cases) {
      expect(decodeAvatar(encodeAvatar(cfg))).toEqual(cfg);
    }
  });

  it('throws for an unknown face id', () => {
    expect(() => encodeAvatar({ kind: 'face', id: 'face-99' as never })).toThrow();
  });
});
