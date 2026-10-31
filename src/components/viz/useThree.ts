"use client";
import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";

export type Three = typeof THREE_NS;

export interface Stage {
  THREE: Three;
  renderer: THREE_NS.WebGLRenderer;
  scene: THREE_NS.Scene;
  camera: THREE_NS.PerspectiveCamera;
  render: () => void;
}

/**
 * Mounts a small Three.js stage in `container`. Three is loaded only when a 3D
 * view is first shown, so the field app stays light when 3D is off. Renders on
 * demand (call stage.render after changing the scene) — no idle animation loop.
 */
export function useThreeStage(height: number, setup: (stage: Stage) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [failed, setFailed] = useState(false);
  const setupRef = useRef(setup);
  setupRef.current = setup;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const el = containerRef.current;
      if (!el) return;
      let THREE: Three;
      try {
        THREE = await import("three");
      } catch {
        setFailed(true);
        return;
      }
      if (disposed) return;
      let renderer: THREE_NS.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      } catch {
        setFailed(true); // no WebGL on this device
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
      el.appendChild(renderer.domElement);
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      const render = () => renderer.render(scene, camera);
      const resize = () => {
        const w = Math.max(el.clientWidth, 1);
        renderer.setSize(w, height, false);
        renderer.domElement.style.height = `${height}px`;
        camera.aspect = w / height;
        camera.updateProjectionMatrix();
        render();
      };
      const s: Stage = { THREE, renderer, scene, camera, render };
      setupRef.current(s);
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      setStage(s);
      cleanup = () => {
        ro.disconnect();
        scene.traverse((o) => {
          const m = o as THREE_NS.Mesh;
          m.geometry?.dispose?.();
          const mat = m.material as THREE_NS.Material | THREE_NS.Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
        });
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [height]);

  return { containerRef, stage, failed };
}
