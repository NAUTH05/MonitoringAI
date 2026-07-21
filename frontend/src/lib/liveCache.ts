import { Camera } from "@/types";
import { Layouts } from "react-grid-layout";

// Module-level cache so returning to /live shows instantly (no cold-start
// spinner) instead of re-fetching + re-mounting everything on tab switch.

interface LiveCache {
  cameras: Camera[] | null;
  layouts: Layouts | null;
}

const cache: LiveCache = { cameras: null, layouts: null };

export const liveCache = {
  getCameras: () => cache.cameras,
  setCameras: (c: Camera[]) => {
    cache.cameras = c;
  },
  getLayouts: () => cache.layouts,
  setLayouts: (l: Layouts) => {
    cache.layouts = l;
  },
};
