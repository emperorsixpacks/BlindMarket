import { useEffect } from 'react';

/** The single owner of theme bootstrap: applies the saved preference
 * (localStorage 'bb.theme', written by the TopBar toggle) on load,
 * defaulting to dark. */
export function getStoredTheme(): 'dark' | 'light' {
  try {
    return localStorage.getItem('bb.theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function ThemeSync() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', getStoredTheme());
  }, []);
  return null;
}
