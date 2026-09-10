"use client";

import { useState } from "react";

type AvatarProps = {
  src?: string | null;
  name: string;
  size?: number;
  color?: string;
  className?: string;
};

export default function Avatar({ src, name, size = 40, color, className }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const showImg = src && !imgError;
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const bg = color || "#3b82f6";

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        background: showImg ? "transparent" : bg,
        color: "#fff",
        fontWeight: 700,
        fontSize: size * 0.38,
        lineHeight: 1,
      }}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt={name}
          width={size}
          height={size}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setImgError(true)}
        />
      ) : (
        initials
      )}
    </div>
  );
}
