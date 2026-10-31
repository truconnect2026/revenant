"use client";
import { useEffect, useRef } from "react";
import type * as THREE_NS from "three";
import { useThreeStage } from "./useThree";

/**
 * Live 3D arrow of a sensor's x/y/z reading in the phone's own frame (x right,
 * y toward the top of the phone, z out of the screen). For Motion it shows
 * gravity plus movement, so at rest it points "down" relative to how the phone
 * is held. For EMF it shows the magnetic field direction. Real readings only.
 */
export function Vector3D({
  vector, scale, color, unit, caption, height = 150,
}: {
  vector: [number, number, number] | null | undefined;
  /** Reading that maps to a full-length arrow (e.g. 9.81 m/s², 60 µT). */
  scale: number;
  color: string;
  unit: string;
  caption: string;
  height?: number;
}) {
  const arrowRef = useRef<THREE_NS.ArrowHelper | null>(null);
  const { containerRef, stage, failed } = useThreeStage(height, ({ THREE, scene, camera }) => {
    // Phone outline
    const phone = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.5, 1, 0.06)),
      new THREE.LineBasicMaterial({ color: 0x52525b })
    );
    scene.add(phone);
    // Axes
    const axis = (to: [number, number, number]) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(...to)]);
      scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x2f3742 })));
    };
    axis([1.1, 0, 0]);
    axis([0, 1.1, 0]);
    axis([0, 0, 1.1]);
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 0), 0.5, new THREE.Color(color).getHex(), 0.16, 0.09);
    scene.add(arrow);
    arrowRef.current = arrow;
    camera.position.set(1.35, 0.85, 2.3);
    camera.lookAt(0, 0, 0);
  });

  useEffect(() => {
    const arrow = arrowRef.current;
    if (!stage || !arrow || !vector) return;
    const v = new stage.THREE.Vector3(vector[0], vector[1], vector[2]);
    const mag = v.length();
    if (mag < 1e-6) return;
    arrow.setDirection(v.clone().normalize());
    const len = Math.max(0.15, Math.min(1.4, (mag / scale) * 1.0));
    arrow.setLength(len, Math.min(0.16, len * 0.35), Math.min(0.09, len * 0.2));
    stage.render();
  }, [vector, stage, scale]);

  if (failed) return null;
  return (
    <div className="readout-well relative overflow-hidden" role="img" aria-label={caption}>
      <div ref={containerRef} style={{ height }} />
      <span className="absolute top-1 left-2 text-[8px] font-mono text-zinc-600 pointer-events-none">{caption}</span>
      {vector && (
        <span className="absolute bottom-1 right-2 text-[9px] font-mono tabular-nums text-zinc-400 pointer-events-none">
          x {vector[0].toFixed(1)} · y {vector[1].toFixed(1)} · z {vector[2].toFixed(1)} {unit}
        </span>
      )}
    </div>
  );
}
