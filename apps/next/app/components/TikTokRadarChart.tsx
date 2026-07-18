"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLang } from "../i18n";

export type RadarMetricKey = "trend_score" | "momentum_score" | "cross_community_score" | "sentiment_score" | "engagement_score";

export type RadarMetric = {
  key: RadarMetricKey;
  value: number; // raw 0-5 score, same scale already used across the product
  label: string;
  businessTag: string;
  helper: string;
};

const SIZE = 100; // svg viewBox units
const CENTER = SIZE / 2;
const MAX_R = SIZE * 0.34;
const RINGS = [0.25, 0.5, 0.75, 1];

function angleFor(index: number) {
  return -90 + index * (360 / 5);
}

function pointAt(index: number, fraction: number) {
  const angle = (angleFor(index) * Math.PI) / 180;
  return {
    x: CENTER + Math.cos(angle) * MAX_R * fraction,
    y: CENTER + Math.sin(angle) * MAX_R * fraction
  };
}

function polygonPoints(fractions: number[]) {
  return fractions.map((fraction, index) => {
    const point = pointAt(index, fraction);
    return `${point.x},${point.y}`;
  }).join(" ");
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Ease-in-out tween between two 5-value fraction sets over ~380ms, skipped entirely
 * under prefers-reduced-motion (jumps straight to the target shape). No animation
 * library involved -- SVG polygon `points` isn't CSS-transitionable, so this is a small
 * hand-rolled rAF tween. */
function useAnimatedFractions(target: number[]) {
  const reducedMotion = usePrefersReducedMotion();
  const [animated, setAnimated] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (reducedMotion) {
      setAnimated(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const duration = 380;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      setAnimated(from.map((value, index) => value + (target[index] - value) * eased));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(target), reducedMotion]);

  return animated;
}

export function TikTokRadarChart({
  metrics,
  centerValue,
  centerLabel
}: {
  metrics: RadarMetric[];
  centerValue: string;
  centerLabel: string;
}) {
  const { lang } = useLang();
  const gradientId = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const targetFractions = metrics.map((metric) => Math.max(0, Math.min(1, metric.value / 5)));
  const fractions = useAnimatedFractions(targetFractions);
  const topScore = Math.max(...targetFractions);

  const active = activeIndex !== null ? metrics[activeIndex] : null;

  return (
    <div className="radarChart">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-labelledby={`${gradientId}-title ${gradientId}-desc`}>
        <title id={`${gradientId}-title`}>{centerLabel}: {centerValue}</title>
        <desc id={`${gradientId}-desc`}>
          {metrics.map((metric) => `${metric.label}: ${metric.businessTag}`).join(". ")}
        </desc>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--radar-fill-start)" />
            <stop offset="100%" stopColor="var(--radar-fill-end)" />
          </linearGradient>
        </defs>

        {RINGS.map((fraction) => (
          <polygon
            key={fraction}
            points={polygonPoints(metrics.map(() => fraction))}
            className="radarGridRing"
          />
        ))}
        {metrics.map((_, index) => {
          const outer = pointAt(index, 1);
          return <line key={index} x1={CENTER} y1={CENTER} x2={outer.x} y2={outer.y} className="radarAxisLine" />;
        })}

        <polygon points={polygonPoints(fractions)} className="radarDataArea" fill={`url(#${gradientId})`} />
        <polygon points={polygonPoints(fractions)} className="radarDataStroke" />

        {metrics.map((metric, index) => {
          const point = pointAt(index, fractions[index]);
          const isTop = targetFractions[index] === topScore && topScore > 0;
          return (
            <circle
              key={metric.key}
              cx={point.x}
              cy={point.y}
              r={activeIndex === index ? 3.4 : 2.4}
              className={`radarNode ${isTop ? "radarNode-top" : ""} ${activeIndex === index ? "active" : ""}`}
              tabIndex={0}
              role="button"
              aria-label={`${metric.label}: ${metric.businessTag}. ${metric.helper}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex((current) => (current === index ? null : current))}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex((current) => (current === index ? null : current))}
              onClick={() => setActiveIndex((current) => (current === index ? null : index))}
            />
          );
        })}
      </svg>

      <div className="radarCenter">
        <strong>{centerValue}</strong>
        <span>{centerLabel}</span>
      </div>

      <div className="radarLabels">
        {metrics.map((metric, index) => {
          // Labels sit close to the axis tips (text-only, no icon badge) -- the business
          // conclusion (metric.businessTag) only shows in the hover/focus tooltip below,
          // not as permanent on-chart decoration.
          const labelPoint = pointAt(index, 1.14);
          return (
            <button
              key={metric.key}
              type="button"
              className={`radarLabel ${activeIndex === index ? "active" : ""}`}
              style={{ left: `${labelPoint.x}%`, top: `${labelPoint.y}%` }}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex((current) => (current === index ? null : current))}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex((current) => (current === index ? null : current))}
              onClick={() => setActiveIndex((current) => (current === index ? null : index))}
            >
              <em>{metric.label}</em>
            </button>
          );
        })}
      </div>

      {active && (
        <div className="radarTooltip" role="status">
          <strong>{active.label}</strong>
          <span>{active.businessTag}</span>
          <p>{active.helper}</p>
        </div>
      )}
      <span className="srOnly">{lang === "zh" ? "五维趋势雷达图" : "Five-dimension trend radar"}</span>
    </div>
  );
}
