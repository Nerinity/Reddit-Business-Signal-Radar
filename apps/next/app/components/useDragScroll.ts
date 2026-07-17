"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DRAG_THRESHOLD_PX = 6;

/**
 * Pointer-drag + wheel-to-horizontal-scroll for a single scroll container. Shared by
 * every horizontal rail/filter row instead of each one re-implementing pointer events.
 * Distinguishes a drag from a click via DRAG_THRESHOLD_PX so links/buttons inside the
 * rail still receive normal clicks when the user didn't actually drag.
 */
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [dragging, setDragging] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const state = useRef({ startX: 0, startScroll: 0, moved: false, pointerId: -1 });

  const updateEdges = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft >= max - 2);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    updateEdges();
    const onScroll = () => updateEdges();
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [updateEdges]);

  const onPointerDown = useCallback((event: React.PointerEvent<T>) => {
    const el = ref.current;
    if (!el || event.button !== 0) return;
    state.current = { startX: event.clientX, startScroll: el.scrollLeft, moved: false, pointerId: event.pointerId };
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<T>) => {
    const el = ref.current;
    if (!el || state.current.pointerId !== event.pointerId || !dragging) return;
    const delta = event.clientX - state.current.startX;
    if (Math.abs(delta) > DRAG_THRESHOLD_PX) state.current.moved = true;
    if (state.current.moved) {
      el.scrollLeft = state.current.startScroll - delta;
      el.setPointerCapture(event.pointerId);
    }
  }, [dragging]);

  const endDrag = useCallback((event: React.PointerEvent<T>) => {
    if (state.current.pointerId === event.pointerId) {
      const el = ref.current;
      if (el && el.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId);
      state.current.pointerId = -1;
    }
    setDragging(false);
    // Swallow the click that follows a real drag so links/buttons under the pointer
    // don't fire a spurious navigation, but let genuine taps/clicks through untouched.
    window.setTimeout(() => { state.current.moved = false; }, 0);
  }, []);

  const onClickCapture = useCallback((event: React.MouseEvent<T>) => {
    if (state.current.moved) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  const onWheel = useCallback((event: React.WheelEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    // Vertical wheel/trackpad scroll on a horizontal rail should pan it sideways;
    // native horizontal wheel/trackpad deltas (deltaX) and Shift+wheel already do this.
    const horizontalIntent = Math.abs(event.deltaX) >= Math.abs(event.deltaY);
    if (horizontalIntent) return;
    el.scrollLeft += event.deltaY;
    event.preventDefault();
  }, []);

  const scrollByAmount = useCallback((direction: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.75, behavior: "smooth" });
  }, []);

  const scrollItemIntoView = useCallback((item: HTMLElement | null) => {
    if (!item || !ref.current) return;
    item.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, []);

  return {
    ref,
    dragging,
    atStart,
    atEnd,
    scrollByAmount,
    scrollItemIntoView,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onPointerLeave: endDrag,
      onClickCapture,
      onWheel
    }
  };
}
