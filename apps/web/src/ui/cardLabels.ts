import { CARD_TEXTS } from '../game/cardTexts';
import { getLang, t, type Lang } from '../i18n/strings';
import type { CardInfo } from '../network/protocol';

/** "BabyDragon" -> "Baby Dragon" */
export function prettyName(name: string): string {
  return name.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

export function cardName(c: Pick<CardInfo, 'id' | 'name'>, lang: Lang = getLang()): string {
  return CARD_TEXTS[c.id]?.[lang] ?? prettyName(c.name);
}

export function cardDesc(c: CardInfo): string {
  const tx = CARD_TEXTS[c.id];
  return tx ? (getLang() === 'ar' ? tx.da : tx.de) : '';
}

/** What the card attacks: ground / air / both / buildings only. */
export function targetsLabel(c: CardInfo): string {
  if (c.tags.includes('buildings')) return t('tgtBuildings');
  const air = c.tags.includes('air');
  const ground = c.tags.includes('ground');
  return t(air && ground ? 'tgtBoth' : air ? 'tgtAir' : 'tgtGround');
}

/** Whether the card's own unit flies, walks, or is a building/spell. */
export function kindLabel(c: CardInfo): string {
  if (c.type === 'SPELL') return t('type1SPELL');
  if (c.type === 'BUILDING') return t('type1BUILDING');
  return t(c.tags.includes('flying') ? 'kindFlying' : 'kindGround');
}

/** Whether the card deals damage to anything (pure support cards have no "hits" line). */
export function attacks(c: CardInfo): boolean {
  return (c.unit?.damage ?? 0) > 0 || (c.spell?.damage ?? 0) > 0;
}
