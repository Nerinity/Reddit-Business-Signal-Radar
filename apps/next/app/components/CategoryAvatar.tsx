"use client";

import { useState } from "react";

function validAssetUrl(url?: string) {
  return Boolean(url && (url.startsWith("/") || /^https?:\/\//i.test(url)));
}

function initials(name: string) {
  return name
    .split(/\s|&/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function CategoryAvatar({ name, illustrationUrl, size = "md" }: { name: string; illustrationUrl?: string; size?: "sm" | "md" | "lg" }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!validAssetUrl(illustrationUrl) || imageFailed) return <i className={`clusterAvatar-${size}`}>{initials(name)}</i>;

  return (
    <span className={`clusterAvatar clusterAvatar-${size}`}>
      <img
        src={illustrationUrl}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setImageFailed(true)}
      />
    </span>
  );
}
