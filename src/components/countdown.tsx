"use client";

import { useEffect, useState } from "react";
import { countdownTo, type CountdownParts } from "@/lib/countdown";
import { cn } from "@/lib/utils";

// Signature element: a live countdown to show day on every event surface.
// Renders server-computed parts first, then ticks client-side every second.
export function Countdown({
  target,
  className,
}: {
  /** show-day moment (ISO string so server → client serialization is exact) */
  target: string;
  className?: string;
}) {
  const targetDate = new Date(target);
  const [parts, setParts] = useState<CountdownParts>(() =>
    countdownTo(targetDate, new Date()),
  );

  useEffect(() => {
    const timer = setInterval(
      () => setParts(countdownTo(new Date(target), new Date())),
      1000,
    );
    return () => clearInterval(timer);
  }, [target]);

  if (parts.reached) {
    return (
      <span
        className={cn(
          "font-mono text-sm uppercase tracking-[0.2em]",
          className,
        )}
      >
        Launch day
      </span>
    );
  }

  const segments: Array<[number, string]> = [
    [parts.days, "d"],
    [parts.hours, "h"],
    [parts.minutes, "m"],
    [parts.seconds, "s"],
  ];

  return (
    <span
      className={cn("font-mono text-sm tabular-nums tracking-wider", className)}
      aria-label="Countdown to launch day"
    >
      {segments.map(([value, unit]) => (
        <span key={unit}>
          {String(value).padStart(2, "0")}
          <span className="text-muted-foreground">{unit} </span>
        </span>
      ))}
    </span>
  );
}
