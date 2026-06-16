"use client";
import { useEffect, useState } from "react";

export function useGeolocation(active: boolean) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: Math.round(pos.coords.latitude * 10000) / 10000,
          lng: Math.round(pos.coords.longitude * 10000) / 10000,
        });
      },
      () => {
        // silently ignore — geolocation is optional
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }, [active]);

  return coords;
}
