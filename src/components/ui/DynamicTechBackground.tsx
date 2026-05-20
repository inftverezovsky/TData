"use client";

import { useEffect, useState } from "react";

// Point-topped hex vertices string
function hexPts(cx: number, cy: number, r: number): string {
  const dx = r * 0.866025;
  const dy = r * 0.5;
  return [
    `${cx},${cy - r}`,
    `${cx + dx},${cy - dy}`,
    `${cx + dx},${cy + dy}`,
    `${cx},${cy + r}`,
    `${cx - dx},${cy + dy}`,
    `${cx - dx},${cy - dy}`,
  ].join(" ");
}

// Circuit pad (small circle terminator on track ends)
function Pad({ cx, cy }: { cx: number; cy: number }) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r="5"
      fill="#f0f0f2"
      stroke="#c8cad0"
      strokeWidth="1.5"
    />
  );
}

// Glowing hexagonal node — matches reference photo style
function HexNode({
  cx, cy, r, color, glowColor, rings = 2,
}: {
  cx: number; cy: number; r: number; color: string; glowColor: string; rings?: number;
}) {
  return (
    <g>
      {/* Outer diffuse glow halo */}
      <circle cx={cx} cy={cy} r={r * 2.8} fill={glowColor} opacity="0.13" />
      <circle cx={cx} cy={cy} r={r * 2.0} fill={glowColor} opacity="0.18" />
      {/* Concentric hex rings (like in reference) */}
      {rings >= 2 && (
        <polygon
          points={hexPts(cx, cy, r * 1.55)}
          fill="none"
          stroke={color}
          strokeWidth="1.2"
          opacity="0.35"
        />
      )}
      <polygon
        points={hexPts(cx, cy, r * 1.18)}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        opacity="0.55"
      />
      {/* Main hex plate */}
      <polygon
        points={hexPts(cx, cy, r)}
        fill={color}
        opacity="0.82"
      />
      {/* Inner bevel highlight */}
      <polygon
        points={hexPts(cx, cy, r * 0.65)}
        fill="none"
        stroke="#ffffff"
        strokeWidth="1"
        opacity="0.45"
      />
      {/* Central bright core */}
      <circle cx={cx} cy={cy} r={r * 0.28} fill="#ffffff" opacity="0.95" />
      <circle cx={cx} cy={cy} r={r * 0.15} fill="#ffffff" opacity="1" />
    </g>
  );
}

// Spark that travels along an SVG path
function Spark({
  path, dur, begin = "0s", color, size = 4,
}: {
  path: string; dur: string; begin?: string; color: string; size?: number;
}) {
  return (
    <g>
      <circle r={size + 2} fill="#ffffff" opacity="0.7">
        <animateMotion dur={dur} begin={begin} repeatCount="indefinite" path={path} />
      </circle>
      <circle r={size} fill={color} opacity="0.95">
        <animateMotion dur={dur} begin={begin} repeatCount="indefinite" path={path} />
      </circle>
      <circle r={size * 0.45} fill="#ffffff" opacity="1">
        <animateMotion dur={dur} begin={begin} repeatCount="indefinite" path={path} />
      </circle>
    </g>
  );
}

export default function DynamicTechBackground() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  // All circuit track paths — sparks travel ONLY along these
  const tracks = {
    // Left cluster: purple node (left) → center-top purple node
    p1: "M 260 420 L 340 340 L 520 340 L 600 260",
    // Left cluster going bottom-left
    p2: "M 260 420 L 180 500 L 100 500 L 60 560",
    p3: "M 260 420 L 200 480 L 80 480 L 40 540",
    p4: "M 260 420 L 180 360 L 80 360 L 40 300",
    p5: "M 260 420 L 260 320 L 180 240 L 100 240",
    // Center-top purple to right cluster
    p6: "M 600 260 L 760 260 L 840 320 L 960 320 L 1020 260",
    p7: "M 600 260 L 680 200 L 800 200",
    // Right cluster (purple flower) internal
    p8: "M 1020 260 L 1100 180 L 1200 180",
    p9: "M 1020 260 L 1140 260 L 1220 200",
    // Right cluster → blue node (bottom-right)
    p10: "M 1020 260 L 1060 340 L 1200 420 L 1280 500 L 1340 580 L 1340 660",
    // Green bottom-left → left purple
    p11: "M 200 700 L 200 600 L 240 540 L 260 480 L 260 420",
    // Green going down-left
    p12: "M 200 700 L 120 780 L 60 780",
    p13: "M 200 700 L 140 760 L 60 840",
    p14: "M 200 700 L 260 760 L 300 820 L 300 900",
    p15: "M 200 700 L 300 700 L 380 640 L 500 640 L 580 700",
    // Blue node (bottom-right) outgoing
    p16: "M 1340 660 L 1420 700 L 1500 700 L 1560 760",
    p17: "M 1340 660 L 1380 740 L 1380 820 L 1320 900",
    p18: "M 1340 660 L 1260 700 L 1200 760 L 1100 760",
    // Top-right small green node outgoing
    p19: "M 1500 100 L 1400 100 L 1340 160 L 1240 160",
    p20: "M 1500 100 L 1560 160 L 1620 160",
  };

  return (
    <div className="fixed inset-0 -z-50 overflow-hidden pointer-events-none select-none">
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Background color */}
          <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e9eaec" />
            <stop offset="100%" stopColor="#dddfe3" />
          </linearGradient>

          {/* Honeycomb tile pattern */}
          <pattern id="hex-tile" width="52" height="90" patternUnits="userSpaceOnUse">
            {/* Row 1 hex */}
            <polygon
              points="26,2 50,15.6 50,42.4 26,56 2,42.4 2,15.6"
              fill="none"
              stroke="#c8cad0"
              strokeWidth="0.8"
              opacity="0.7"
            />
            {/* Row 2 offset hex */}
            <polygon
              points="26,47 50,60.6 50,87.4 26,101 2,87.4 2,60.6"
              fill="none"
              stroke="#c8cad0"
              strokeWidth="0.8"
              opacity="0.7"
            />
            {/* Light reflection lines for subtle 3D engraved look */}
            <polygon
              points="27,3 51,16.6 51,43.4"
              fill="none"
              stroke="#ffffff"
              strokeWidth="0.5"
              opacity="0.55"
            />
          </pattern>

          {/* Glow filter for sparks */}
          <filter id="spark-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Node glow filter */}
          <filter id="node-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 1. Base background */}
        <rect width="1600" height="900" fill="url(#bg-grad)" />

        {/* 2. Honeycomb mesh */}
        <rect width="1600" height="900" fill="url(#hex-tile)" />

        {/* 3. Circuit tracks — bottom shadow layer for embossed 3D effect */}
        <g stroke="#ffffff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" transform="translate(0.8,1)">
          {Object.values(tracks).map((d, i) => <path key={i} d={d} />)}
        </g>

        {/* 4. Circuit tracks — main dark wire layer */}
        <g stroke="#b0b4be" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.9">
          {Object.values(tracks).map((d, i) => <path key={i} d={d} />)}
        </g>

        {/* 5. Circuit track endpoint pads */}
        <g filter="url(#spark-glow)">
          <Pad cx={60} cy={560} /><Pad cx={40} cy={540} /><Pad cx={40} cy={300} />
          <Pad cx={100} cy={240} /><Pad cx={800} cy={200} /><Pad cx={1200} cy={180} />
          <Pad cx={1220} cy={200} /><Pad cx={60} cy={780} /><Pad cx={60} cy={840} />
          <Pad cx={300} cy={900} /><Pad cx={1560} cy={760} /><Pad cx={1320} cy={900} />
          <Pad cx={1100} cy={760} /><Pad cx={1620} cy={160} /><Pad cx={1240} cy={160} />
          <Pad cx={580} cy={700} />
        </g>

        {/* 6. Glowing Hexagonal Nodes */}
        {/* Left purple node */}
        <g filter="url(#node-glow)">
          <HexNode cx={260} cy={420} r={28} color="#9b5de5" glowColor="#a855f7" rings={2} />
        </g>

        {/* Center-top purple node */}
        <g filter="url(#node-glow)">
          <HexNode cx={600} cy={260} r={24} color="#8b5cf6" glowColor="#a855f7" rings={1} />
        </g>

        {/* Right flower cluster — 7 purple hexagons */}
        <g filter="url(#node-glow)">
          {/* Center */}
          <HexNode cx={1020} cy={260} r={22} color="#7c3aed" glowColor="#a855f7" rings={1} />
          {/* Petals */}
          {[0,1,2,3,4,5].map(i => {
            const angle = (i * 60 - 90) * Math.PI / 180;
            const px = 1020 + 58 * Math.cos(angle);
            const py = 260 + 58 * Math.sin(angle);
            return <HexNode key={i} cx={px} cy={py} r={20} color="#9333ea" glowColor="#a855f7" rings={1} />;
          })}
        </g>

        {/* Bottom-left green node with concentric rings */}
        <g filter="url(#node-glow)">
          <HexNode cx={200} cy={700} r={34} color="#10b981" glowColor="#10b981" rings={2} />
        </g>

        {/* Bottom-right blue node */}
        <g filter="url(#node-glow)">
          <HexNode cx={1340} cy={660} r={32} color="#0ea5e9" glowColor="#06b6d4" rings={2} />
        </g>

        {/* Top-right small green node */}
        <g filter="url(#node-glow)">
          <HexNode cx={1500} cy={100} r={20} color="#10b981" glowColor="#10b981" rings={1} />
        </g>

        {/* 7. Animated sparks strictly on tracks */}
        <g filter="url(#spark-glow)">
          {/* Purple sparks */}
          <Spark path={tracks.p1} dur="5s" begin="0s" color="#a855f7" size={3.5} />
          <Spark path={tracks.p2} dur="6s" begin="1.2s" color="#a855f7" size={3} />
          <Spark path={tracks.p4} dur="5.5s" begin="2.8s" color="#a855f7" size={3} />
          <Spark path={tracks.p6} dur="5s" begin="0.5s" color="#8b5cf6" size={3.5} />
          <Spark path={tracks.p7} dur="4s" begin="1.8s" color="#8b5cf6" size={3} />
          <Spark path={tracks.p8} dur="4.5s" begin="3s" color="#9333ea" size={3} />
          <Spark path={tracks.p9} dur="5.2s" begin="0.8s" color="#9333ea" size={3} />
          {/* Green sparks */}
          <Spark path={tracks.p11} dur="6.5s" begin="0s" color="#10b981" size={4} />
          <Spark path={tracks.p12} dur="5s" begin="2s" color="#10b981" size={3} />
          <Spark path={tracks.p15} dur="7s" begin="1s" color="#10b981" size={3.5} />
          {/* Blue sparks */}
          <Spark path={tracks.p10} dur="7.5s" begin="0.5s" color="#0ea5e9" size={4} />
          <Spark path={tracks.p16} dur="5s" begin="2.5s" color="#0ea5e9" size={3} />
          <Spark path={tracks.p17} dur="6s" begin="1.5s" color="#0ea5e9" size={3} />
          {/* Green top-right */}
          <Spark path={tracks.p19} dur="5.5s" begin="3s" color="#10b981" size={3} />
        </g>
      </svg>
    </div>
  );
}
