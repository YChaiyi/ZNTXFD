"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    goatcounter?: {
      count?: (data: { path: string; title?: string }) => void;
    };
  }
}

export function GoatCounterRouteTracker() {
  const pathname = usePathname();
  const didMount = useRef(false);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }

    const path = `${window.location.host}${pathname}${window.location.search}`;
    window.goatcounter?.count?.({ path, title: document.title });
  }, [pathname]);

  return null;
}
