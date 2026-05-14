import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChainBanner } from '../ChainBanner';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function DashboardLayout() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const dist = reduceMotion ? 0 : 8;
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="md:ml-[240px] flex flex-col min-h-screen">
        <TopBar onMenuClick={() => setNavOpen(true)} />
        <ChainBanner />
        <main
          className="flex-1 px-4 sm:px-6 md:px-8 pt-4 sm:pt-6 md:pt-8"
          style={{
            // Respect iOS safe-area at the bottom so the last action button
            // isn't hidden under the home indicator on notched devices.
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: dist }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -dist }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
