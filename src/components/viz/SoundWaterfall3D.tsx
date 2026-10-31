"use client";
import { useEffect, useRef } from "react";
import type * as THREE_NS from "three";
import { useThreeStage } from "./useThree";

const BINS = 48;
const ROWS = 40;
const W = 2.4; // scene width (pitch axis)
const D = 2.2; // scene depth (time axis)
const H = 0.75; // max height

/** black → red → yellow → white, matching the 2D spectrograms. */
function heat(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  if (t < 1 / 3) return [(t * 3) * 0.86, 0, 0];
  if (t < 2 / 3) return [0.86, (t - 1 / 3) * 3 * 0.78, 0];
  const u = (t - 2 / 3) * 3;
  return [0.86 + u * 0.14, 0.78 + u * 0.22, u * 0.78];
}

/** Map the analyser's linear bins onto log-spaced pitch bins (max within each). */
function logBins(spectrum: number[]): number[] {
  const n = spectrum.length;
  if (n < 2) return new Array(BINS).fill(0);
  const out: number[] = [];
  const lo = Math.log(1);
  const hi = Math.log(n - 1);
  for (let b = 0; b < BINS; b++) {
    const a = Math.floor(Math.exp(lo + ((hi - lo) * b) / BINS));
    const z = Math.max(a + 1, Math.floor(Math.exp(lo + ((hi - lo) * (b + 1)) / BINS)));
    let m = 0;
    for (let i = a; i < Math.min(z, n); i++) m = Math.max(m, spectrum[i]);
    out.push(m);
  }
  return out;
}

/**
 * 3D spectrum waterfall for the Sound card: pitch left→right (log scale),
 * time receding into the distance, loudness as height and heat colour. Fed by
 * the microphone's real FFT frames (~5 per second) — nothing interpolated.
 */
export function SoundWaterfall3D({ spectrum, height = 150 }: { spectrum: number[] | undefined; height?: number }) {
  const meshRef = useRef<THREE_NS.Mesh | null>(null);
  const historyRef = useRef<number[][]>([]);

  const { containerRef, stage, failed } = useThreeStage(height, ({ THREE, scene, camera }) => {
    const geo = new THREE.PlaneGeometry(W, D, BINS - 1, ROWS - 1);
    geo.rotateX(-Math.PI / 2); // lay flat: x = pitch, z = time, y = loudness
    const colors = new Float32Array(geo.attributes.position.count * 3);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.08 })
    );
    scene.add(mesh);
    mesh.add(wire);
    meshRef.current = mesh;
    const grid = new THREE.GridHelper(W, 8, 0x2a3340, 0x1a2029);
    grid.position.y = -0.002;
    scene.add(grid);
    camera.position.set(0, 1.55, 2.35);
    camera.lookAt(0, 0.1, -0.15);
  });

  useEffect(() => {
    const mesh = meshRef.current;
    if (!stage || !mesh || !spectrum || spectrum.length === 0) return;
    const frame = logBins(spectrum);
    const hist = historyRef.current;
    hist.unshift(frame);
    if (hist.length > ROWS) hist.length = ROWS;
    const pos = mesh.geometry.attributes.position as THREE_NS.BufferAttribute;
    const col = mesh.geometry.attributes.color as THREE_NS.BufferAttribute;
    // PlaneGeometry vertex order: row by row from the far edge (−z) to the near edge (+z).
    for (let r = 0; r < ROWS; r++) {
      const data = hist[ROWS - 1 - r]; // newest frame on the near edge
      for (let b = 0; b < BINS; b++) {
        const i = r * BINS + b;
        const v = data ? data[b] : 0;
        pos.setY(i, v * H);
        const [cr, cg, cb] = heat(v);
        col.setXYZ(i, cr, cg, cb);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    // Wireframe follows the surface.
    const wire = mesh.children[0] as THREE_NS.LineSegments;
    wire.geometry.dispose();
    wire.geometry = new stage.THREE.WireframeGeometry(mesh.geometry);
    stage.render();
  }, [spectrum, stage]);

  useEffect(() => () => { historyRef.current = []; }, []);

  if (failed) return null;
  return (
    <div className="readout-well relative overflow-hidden" aria-label="3D sound spectrum waterfall" role="img">
      <span className="absolute top-1 left-2 text-[8px] font-mono text-zinc-600 pointer-events-none">older ↑ · now ↓</span>
      <div ref={containerRef} style={{ height }} />
      <div className="flex justify-between px-2 pb-1 text-[8px] font-mono text-zinc-600">
        <span>low pitch</span>
        <span>high pitch</span>
      </div>
    </div>
  );
}
