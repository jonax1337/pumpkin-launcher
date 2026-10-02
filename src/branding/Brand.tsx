import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSettings } from '@/store/settings';
import { useGame } from '@/store/game';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { currentSeason, nextSeasonCheck, type SeasonId } from './calendar';
import { croppedWindowIcon } from './windowIcon';
import wordmark from '../../branding/pumpkin-launcher/wordmark/light.svg';

const assets = import.meta.glob<string>([
  '../../branding/pumpkin-launcher/assets/*/mark.svg',
  '../../branding/pumpkin-launcher/assets/*/128x128.png',
  '../../branding/pumpkin-launcher/motion/*/*.svg',
], { eager: true, query: '?url', import: 'default' });

export type BuddyMood = 'idle' | 'hello' | 'loading' | 'success' | 'oops' | 'sleep';
export function brandAsset(season: SeasonId, file: 'mark.svg' | '128x128.png' | `${BuddyMood | 'poster'}.svg`) {
  const folder = file === 'mark.svg' || file === '128x128.png' ? 'assets' : 'motion';
  return assets[`../../branding/pumpkin-launcher/${folder}/${season}/${file}`];
}

const BrandContext = createContext({ season: currentSeason(), animate: false });
export const useBrand = () => useContext(BrandContext);

/** Eine Uhr versorgt UI, Favicon und natives Fenster, auch über einen Saisonwechsel hinweg. */
export function BrandProvider({ children }: { children: ReactNode }) {
  const pumpkin = useSettings((s) => s.pumpkin);
  const [season, setSeason] = useState(() => currentSeason(new Date(), pumpkin));
  const [visible, setVisible] = useState(!document.hidden);
  const reduced = useReducedMotion();
  const motion = useSettings((s) => s.motion);
  const playing = useGame((s) => Object.keys(s.started).length > 0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      setSeason(currentSeason(new Date(), pumpkin));
      setVisible(!document.hidden);
      timer = setTimeout(check, nextSeasonCheck());
    };
    check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [pumpkin]);

  useLayoutEffect(() => {
    document.documentElement.dataset.season = season.id;
    document.documentElement.style.setProperty('--copper', season.accent);
    document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href = brandAsset(season.id, 'mark.svg');
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = season.accent;
  }, [season]);

  useEffect(() => {
    if (!isTauri()) return;
    const abort = new AbortController();
    void croppedWindowIcon(brandAsset(season.id, 'mark.svg'))
      .then((bytes) => { if (!abort.signal.aborted) return getCurrentWindow().setIcon(bytes); })
      .catch((error) => { if (!abort.signal.aborted) console.error('Pumpkin-App-Icon konnte nicht aktualisiert werden', error); });
    return () => abort.abort();
  }, [season]);

  return <BrandContext value={{ season, animate: motion && !reduced && visible && !playing }}>{children}</BrandContext>;
}

export function BrandMark({ size = 32 }: { size?: number }) {
  const { season } = useBrand();
  return <img className="brand-mark" src={brandAsset(season.id, 'mark.svg')} width={size} height={size} alt="" aria-hidden />;
}

/** Das Bild der Wortmarke; im Windows-Kontrastmodus (a11y.css) tritt der Text daneben an seine Stelle, weil die hellen Buchstaben des Bilds dort nicht lesbar wären. */
export function BrandWordmark({ className = '' }: { className?: string }) {
  return (
    <>
      <img className={`brand-wordmark ${className}`} src={wordmark} width={214} height={24} alt="Pumpkin Launcher" />
      <span className="brand-wordmark-text">Pumpkin Launcher</span>
    </>
  );
}

export function Buddy({ mood = 'idle', size = 96, className = '' }: { mood?: BuddyMood; size?: number; className?: string }) {
  const { season, animate } = useBrand();
  const ref = useRef<HTMLImageElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const pose = animate && inView ? mood : 'poster';
  return (
    <img
      ref={ref} className={`buddy ${className}`} src={brandAsset(season.id, `${pose}.svg`)} width={size} height={size}
      alt="" aria-hidden data-mood={mood} data-pose={pose}
    />
  );
}
