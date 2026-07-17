"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useLang } from "../i18n";
import { useDragScroll } from "./useDragScroll";

/**
 * One shared horizontal-scroll shell for rails and filter rows: pointer drag, wheel/
 * trackpad/Shift+wheel, touch (native), prev/next arrows, and edge-fade masks. Callers
 * only supply the row content -- no module re-implements pointer-event handling itself.
 */
export function HorizontalScroller({
  children,
  className = "",
  ariaLabel,
  showArrows = true
}: {
  children: ReactNode;
  className?: string;
  ariaLabel: string;
  showArrows?: boolean;
}) {
  const { lang } = useLang();
  const { ref, dragging, atStart, atEnd, scrollByAmount, handlers } = useDragScroll<HTMLDivElement>();
  return (
    <div className={`hScrollerShell ${className}`.trim()}>
      {showArrows && (
        <button
          type="button"
          className="hScrollerArrow hScrollerArrow-prev"
          aria-label={lang === "zh" ? "向左滚动" : "Scroll left"}
          onClick={() => scrollByAmount(-1)}
          disabled={atStart}
        >
          <ChevronLeft size={16} />
        </button>
      )}
      <div className={`hScrollerFade hScrollerFade-start ${atStart ? "hidden" : ""}`} aria-hidden="true" />
      <div
        ref={ref}
        className={`hScroller ${dragging ? "dragging" : ""}`}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        {...handlers}
      >
        {children}
      </div>
      <div className={`hScrollerFade hScrollerFade-end ${atEnd ? "hidden" : ""}`} aria-hidden="true" />
      {showArrows && (
        <button
          type="button"
          className="hScrollerArrow hScrollerArrow-next"
          aria-label={lang === "zh" ? "向右滚动" : "Scroll right"}
          onClick={() => scrollByAmount(1)}
          disabled={atEnd}
        >
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}
