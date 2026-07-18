"use client";

import { useEffect, useState } from "react";

export type BrandAvatarSize = "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<BrandAvatarSize, number> = {
  sm: 36,
  md: 44,
  lg: 58,
  xl: 104
};

function isValidLogoUrl(url?: string): url is string {
  if (!url || !url.trim()) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The single shared representation of a brand across the product. Every page renders
 * this instead of re-implementing its own logo/initials tile. A white rounded-square
 * plate keeps transparent-background logo assets legible against the dark theme;
 * initials render inside that same plate so the fallback never reads as a different
 * component. Three independent fallback paths, in order: no logo_url at all, a
 * logo_url that isn't even a well-formed http(s) URL, and a logo_url that is
 * well-formed but 404s / fails to load once the browser actually requests it.
 */
export function BrandAvatar({
  name,
  logoUrl,
  signalType,
  size = "md",
  className = ""
}: {
  name: string;
  logoUrl?: string;
  signalType?: string;
  size?: BrandAvatarSize;
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const canShowLogo = Boolean(signalType) && isValidLogoUrl(logoUrl) && !imageFailed;
  const dimension = SIZE_PX[size];

  useEffect(() => setImageFailed(false), [logoUrl, signalType]);

  return (
    <span
      className={`brandAvatar brandAvatar-${size} ${canShowLogo ? "" : "brandAvatar-fallback"} ${className}`.trim()}
      style={{ width: dimension, height: dimension }}
    >
      {canShowLogo ? (
        <img src={logoUrl} alt={`${name} logo`} loading="lazy" onError={() => setImageFailed(true)} />
      ) : (
        <img
          className="brandAvatarFallbackImage"
          src="/assets/reddit-signal-avatar.png"
          alt={`${name} Reddit fallback`}
          loading="lazy"
        />
      )}
    </span>
  );
}
