import { useState, useEffect } from 'react';

/** タッチデバイス判定（一度だけ評価） */
export const IS_TOUCH =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0);

function checkLandscape(): boolean {
  return IS_TOUCH && window.innerWidth > window.innerHeight;
}

/**
 * スマホ横画面（landscape）かどうかを返すフック。
 * orientationchange / resize 両方を監視して動的に切り替わる。
 */
export function useIsLandscape(): boolean {
  const [landscape, setLandscape] = useState(checkLandscape);

  useEffect(() => {
    const handler = () => setLandscape(checkLandscape());
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
    };
  }, []);

  return landscape;
}
