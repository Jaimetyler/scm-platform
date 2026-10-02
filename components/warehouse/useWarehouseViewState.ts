"use client";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { usePathname } from "next/navigation";

// Only use for view preferences. Never put rows, driver details, or unsaved edits here.
export function useWarehouseViewState<T>(name: string, initial: T): [T, Dispatch<SetStateAction<T>>, boolean] {
  const path = usePathname();
  const key = `scm.warehouse.view.v1:${path}:${name}`;
  const initialRef = useRef(initial);
  const [value, setValue] = useState(initial);
  const [loadedKey, setLoadedKey] = useState("");
  useEffect(() => {
    let restored = initialRef.current;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (saved !== null && typeof saved === typeof restored && !Array.isArray(saved)) {
        // Ignore wrong-shaped or old stored preferences.
        if (typeof restored !== "object" || Object.keys(restored as object).every((field) => typeof saved[field] === typeof restored[field])) restored = saved;
      }
    } catch { /* Storage can be unavailable. The page still works normally. */ }
    setValue(restored);
    setLoadedKey(key);
  }, [key]);
  useEffect(() => {
    if (loadedKey !== key) return;
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Optional preference storage. */ }
  }, [key, loadedKey, value]);
  return [value, setValue, loadedKey === key];
}

export function WarehouseScrollMemory() {
  const path = usePathname();
  useEffect(() => {
    const key = `scm.warehouse.scroll.v1:${path}`;
    let target = 0;
    try { target = Math.max(0, Number(sessionStorage.getItem(key)) || 0); } catch { /* Optional. */ }
    let restoring = target > 0;
    let frame = 0;
    const restore = () => {
      if (!restoring) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!restoring) return;
        window.scrollTo({ top: target, behavior: "instant" });
        if (Math.abs(window.scrollY - target) < 2) restoring = false;
      });
    };
    const observer = new ResizeObserver(restore);
    observer.observe(document.body);
    restore();
    const stop = () => { restoring = false; };
    const save = () => {
      if (!restoring) try { sessionStorage.setItem(key, String(window.scrollY)); } catch { /* Optional. */ }
    };
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("pagehide", save);
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) window.addEventListener(event, stop, { passive: true });
    const timeout = window.setTimeout(stop, 10000);
    return () => {
      // Save on scroll, not teardown: Next may already have scrolled the new page.
      observer.disconnect(); cancelAnimationFrame(frame); window.clearTimeout(timeout);
      window.removeEventListener("scroll", save); window.removeEventListener("pagehide", save);
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) window.removeEventListener(event, stop);
    };
  }, [path]);
  return null;
}
