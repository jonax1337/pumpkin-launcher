import { cn } from '@/lib/utils';
import mark from '../../branding/pumpkin-launcher/assets/mark.svg';
import wordmark from '../../branding/pumpkin-launcher/wordmark/light.svg';

/** Pumpkin Block aus Konzept 01; die bestehenden Markenplätze bleiben erhalten. */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return <img className={cn('brand-mark', className)} src={mark} width={size} height={size} alt="" aria-hidden />;
}
const BAR_SHADOW = '[filter:drop-shadow(var(--tsh))]';
/** Bild der Wortmarke: feste Größe (214 × 24), kein Layoutsprung. Im Kontrastmodus (`forced-colors:`) trägt der Text daneben die Marke. */
const WORDMARK_IMAGE = 'block h-6 w-[214px] flex-none object-contain [image-rendering:pixelated] forced-colors:hidden';
/** Fensterleiste: kleiner (178,5 × 20), ab 900 px abwärts 142,8 × 16, bis einschließlich 820 px ganz entfallen (Bild und Text). */
const WORDMARK_IMAGE_BAR = `h-5 w-[178.5px] le-900:h-4 le-900:w-[142.8px] le-820:hidden ${BAR_SHADOW}`;
/**
 * Windows-Kontrastmodus: das Bild trägt helle Buchstaben und wäre auf hellem Grund unsichtbar; stattdessen steht der Name als Text
 * in der Anzeigeschrift und folgt den Systemfarben. Sonst ist der Text nicht da.
 */
const WORDMARK_TEXT = 'hidden whitespace-nowrap font-(family-name:--f-display) text-[20px] leading-none font-extrabold tracking-[.01em] uppercase forced-colors:block';

/** Wortmarke als Bild mit Textersatz im Windows-Kontrastmodus. `bar`: Größen und Schatten der Fensterleiste; `className` ergänzt oder ersetzt Utilities. */
export function BrandWordmark({ bar = false, className }: { bar?: boolean; className?: string }) {
  return (
    <>
      <img className={cn(WORDMARK_IMAGE, bar && WORDMARK_IMAGE_BAR, className)} src={wordmark} width={214} height={24} alt="Pumpkin Launcher" />
      <span className={cn(WORDMARK_TEXT, bar && 'le-820:hidden')}>Pumpkin Launcher</span>
    </>
  );
}
