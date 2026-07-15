"use client";

import { useState } from "react";

export type BrandAvatarSize = "sm" | "md" | "lg";

const SIZE_PX: Record<BrandAvatarSize, number> = {
  sm: 36,
  md: 44,
  lg: 58
};

function initials(name: string) {
  return name
    .split(/\s|&/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

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
  size = "md",
  className = ""
}: {
  name: string;
  logoUrl?: string;
  size?: BrandAvatarSize;
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const canShowLogo = isValidLogoUrl(logoUrl) && !imageFailed;
  const dimension = SIZE_PX[size];

  return (
    <span
      className={`brandAvatar brandAvatar-${size} ${canShowLogo ? "" : "brandAvatar-fallback"} ${className}`.trim()}
      style={{ width: dimension, height: dimension }}
    >
      {canShowLogo ? (
        <img src={logoUrl} alt={`${name} logo`} loading="lazy" onError={() => setImageFailed(true)} />
      ) : (
        <span className="brandAvatarInitials" aria-label={name}>
          {initials(name) || "•"}
        </span>
      )}
    </span>
  );
}
