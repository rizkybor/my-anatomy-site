// app/page.tsx
"use client";

import React, { Suspense, useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, ScrollControls, Preload, useGLTF, useScroll } from "@react-three/drei";
import * as THREE from "three";

type GLTF = { scene: THREE.Group; nodes?: any; materials?: any };

// ====== CONFIG ======
const MODEL_URL = "/models/Mia_Muscles_OBG.glb";
// Model rotation: [0,0,0] faces forward; flip Y to Math.PI if backwards
const ROTATION_FIX: [number, number, number] = [0, 0, 0];
let MODEL_SCALE = 1.2;
const MODEL_Y_OFFSET = -0.5;
const ROTATION_INTENSITY = 0.9;
const VERTICAL_BOB = 0.6;
// Pointer rotation intensity (how much model rotates from pointer X)
const POINTER_ROT_MAX = 0.45; // radians (~25deg)
// ====================

type BBox = {
  min: THREE.Vector3;
  max: THREE.Vector3;
  center: THREE.Vector3;
  size: THREE.Vector3;
  height: number;
};

function useModelBBox(url: string) {
  const gltf = useGLTF(url) as GLTF;
  const [bbox, setBbox] = useState<BBox | null>(null);

  useEffect(() => {
    if (!gltf || !gltf.scene) return;
    const sceneClone = gltf.scene.clone(true);
    sceneClone.scale.setScalar(MODEL_SCALE);
    sceneClone.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(sceneClone);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    setBbox({
      min: box.min.clone(),
      max: box.max.clone(),
      center,
      size,
      height: size.y,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf]);

  return { gltf, bbox };
}

/**
 * ModelInstance now accepts pointerX prop (normalized -1..1)
 * pointerX influences a small additional rotation on Y axis.
 */
function ModelInstance({ gltf, pointerX }: { gltf: GLTF; pointerX: number }) {
  const groupRef = useRef<THREE.Group | null>(null);
  const scroll = useScroll();

  // smoothing refs
  const rotYRef = useRef(0);
  const rotXRef = useRef(0);
  const posYRef = useRef(MODEL_Y_OFFSET);

  useFrame(() => {
    if (!groupRef.current) return;
    const t = scroll.offset; // 0..1

    // base motion from scroll
    const targetBaseRotY = (1 - t * ROTATION_INTENSITY) * Math.PI * 0.02; // tiny base rotation
    const targetBaseRotX = (t - 0.5) * 0.06;
    const targetY = MODEL_Y_OFFSET + (0.5 - t) * VERTICAL_BOB;

    // pointer-driven additional Y rotation
    const pointerTargetY = pointerX * POINTER_ROT_MAX; // -max..max

    // combine base + pointer, but keep pointer influence dominant for horizontal rotate
    const targetCombinedY = targetBaseRotY + pointerTargetY;

    // smooth lerp
    rotYRef.current += (targetCombinedY - rotYRef.current) * 0.12;
    rotXRef.current += (targetBaseRotX - rotXRef.current) * 0.06;
    posYRef.current += (targetY - posYRef.current) * 0.08;

    // apply
    groupRef.current.rotation.y = ROTATION_FIX[1] + rotYRef.current;
    groupRef.current.rotation.x = ROTATION_FIX[0] + rotXRef.current;
    groupRef.current.position.y = posYRef.current;
  });

  return (
    <group ref={groupRef} position={[0, MODEL_Y_OFFSET, 0]} rotation={ROTATION_FIX} scale={MODEL_SCALE}>
      <primitive object={gltf.scene} />
    </group>
  );
}

/**
 * CameraRig: keep behavior from before (no zoom on Z), camera vertical + lookAt changes
 * unchanged here (we pass sectionTargets computed from bbox).
 */
function CameraRig({ sectionTargets }: { sectionTargets: { camY: number; camZ: number; lookAt: THREE.Vector3 }[] | null }) {
  const { camera } = useThree();
  const dreiScroll = useScroll();

  const lastDrei = useRef<number | null>(null);
  const lastChangeTime = useRef<number>(performance.now());
  const useWindowFallback = useRef(false);
  const initialZ = useRef<number | null>(null);

  useFrame(() => {
    if (initialZ.current === null) initialZ.current = camera.position.z;

    const dreiOffset = typeof dreiScroll?.offset === "number" ? dreiScroll.offset : 0;
    const now = performance.now();

    if (lastDrei.current === null) {
      lastDrei.current = dreiOffset;
      lastChangeTime.current = now;
    } else {
      if (Math.abs(dreiOffset - lastDrei.current) > 1e-5) {
        useWindowFallback.current = false;
        lastDrei.current = dreiOffset;
        lastChangeTime.current = now;
      } else {
        if (now - lastChangeTime.current > 300 && Math.abs(dreiOffset) < 1e-6) {
          useWindowFallback.current = true;
        }
      }
    }

    let t = dreiOffset;
    if (useWindowFallback.current) {
      const scrollY = window.scrollY || window.pageYOffset || 0;
      const docH = document.documentElement.scrollHeight || document.body.scrollHeight || 1;
      const winH = window.innerHeight || 1;
      const maxScroll = Math.max(1, docH - winH);
      t = Math.min(Math.max(scrollY / maxScroll, 0), 1);
    }

    const targets = sectionTargets ?? [
      { camY: 1.6, camZ: initialZ.current ?? 4, lookAt: new THREE.Vector3(0, 0.9, 0) },
      { camY: 0.6, camZ: initialZ.current ?? 4, lookAt: new THREE.Vector3(0, 0.2, 0) },
      { camY: -0.6, camZ: initialZ.current ?? 4, lookAt: new THREE.Vector3(0, -0.6, 0) },
      { camY: -2.0, camZ: initialZ.current ?? 4, lookAt: new THREE.Vector3(0, -1.8, 0) },
    ];

    const segments = Math.max(1, targets.length - 1);
    const scaled = Math.min(Math.max(t * segments, 0), segments);
    const i = Math.floor(scaled);
    const localT = scaled - i;

    const a = targets[i];
    const b = targets[Math.min(i + 1, targets.length - 1)];

    const targetY = a.camY + (b.camY - a.camY) * localT;
    const targetZ = initialZ.current ?? camera.position.z;

    const lx = a.lookAt.x + (b.lookAt.x - a.lookAt.x) * localT;
    const ly = a.lookAt.y + (b.lookAt.y - a.lookAt.y) * localT;
    const lz = a.lookAt.z + (b.lookAt.z - a.lookAt.z) * localT;

    camera.position.y += (targetY - camera.position.y) * 0.12;
    camera.position.z = targetZ;
    camera.lookAt(lx, ly, lz);
  });

  return null;
}

/** Overlay: show drei.offset and window norm for debugging */
function ScrollOverlay() {
  const dreiScroll = useScroll();
  const [dreiVal, setDreiVal] = useState(0);
  const [winVal, setWinVal] = useState(0);

  useFrame(() => {
    const d = typeof dreiScroll?.offset === "number" ? dreiScroll.offset : 0;
    setDreiVal(Number(d.toFixed(3)));

    const scrollY = window.scrollY || window.pageYOffset || 0;
    const docH = document.documentElement.scrollHeight || document.body.scrollHeight || 1;
    const winH = window.innerHeight || 1;
    const maxScroll = Math.max(1, docH - winH);
    const w = Math.min(Math.max(scrollY / maxScroll, 0), 1);
    setWinVal(Number(w.toFixed(3)));
  });

  return (
    <Html position={[0, -2.5, 0]} center>
      <div style={{ position: "fixed", left: 12, top: 12, padding: "8px 10px", background: "rgba(0,0,0,0.65)", color: "white", borderRadius: 8, fontSize: 13, zIndex: 9999 }}>
        <div>drei.offset: <strong>{dreiVal}</strong></div>
        <div>window.norm: <strong>{winVal}</strong></div>
        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8 }}>Move cursor left/right to rotate model.</div>
      </div>
    </Html>
  );
}

function SceneWithAutoTargets({ pointerX }: { pointerX: number }) {
  const { gltf, bbox } = useModelBBox(MODEL_URL);

  const sectionTargets = useMemo(() => {
    if (!bbox) return null;
    const topY = bbox.max.y;
    const bottomY = bbox.min.y;
    const centerY = bbox.center.y;
    const height = bbox.height || Math.max(1, topY - bottomY);
    const baseZ = Math.max(3.0, height * 3.0);

    const headCamY = topY + height * 0.15;
    const headLookAt = new THREE.Vector3(0, topY - height * 0.08, 0);

    const torsoCamY = centerY + height * 0.15;
    const torsoLookAt = new THREE.Vector3(0, centerY + height * 0.02, 0);

    const armsCamY = centerY - height * 0.2;
    const armsLookAt = new THREE.Vector3(0, centerY - height * 0.25, 0);

    const legsCamY = bottomY + height * 0.25;
    const legsLookAt = new THREE.Vector3(0, bottomY + height * 0.15, 0);

    return [
      { camY: headCamY + MODEL_Y_OFFSET, camZ: baseZ * 0.9, lookAt: headLookAt },
      { camY: torsoCamY + MODEL_Y_OFFSET, camZ: baseZ * 0.75, lookAt: torsoLookAt },
      { camY: armsCamY + MODEL_Y_OFFSET, camZ: baseZ * 0.65, lookAt: armsLookAt },
      { camY: legsCamY + MODEL_Y_OFFSET, camZ: baseZ * 0.55, lookAt: legsLookAt },
    ];
  }, [bbox]);

  return (
    <>
      <ambientLight intensity={0.95} />
      <directionalLight position={[10, 10, 10]} intensity={1.0} />
      <Suspense fallback={<Html center>Loading 3D model...</Html>}>
        {gltf && <ModelInstance gltf={gltf} pointerX={pointerX} />}
      </Suspense>

      <CameraRig sectionTargets={sectionTargets} />
      <ScrollOverlay />
      <Preload all />
    </>
  );
}

export default function Page() {
  // pointerX normalized -1..1 (left..right)
  const [pointerX, setPointerX] = useState(0);

  // handlers: update pointerX from mouse / touch
  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      const x = e.clientX;
      const w = window.innerWidth || 1;
      const nx = Math.min(Math.max((x / w) * 2 - 1, -1), 1); // -1..1
      setPointerX(nx);
    };
    const handleTouch = (e: TouchEvent) => {
      if (!e.touches || e.touches.length === 0) return;
      const x = e.touches[0].clientX;
      const w = window.innerWidth || 1;
      const nx = Math.min(Math.max((x / w) * 2 - 1, -1), 1);
      setPointerX(nx);
    };

    window.addEventListener("mousemove", handleMouse);
    window.addEventListener("touchmove", handleTouch, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handleMouse);
      window.removeEventListener("touchmove", handleTouch);
    };
  }, []);

  useEffect(() => {
    // dev helper: ensure page scrollable
    const sh = document.documentElement.scrollHeight;
    const wh = window.innerHeight;
    if (sh <= wh) {
      document.body.style.minHeight = `150vh`;
    }
  }, []);

  return (
    <div className="min-h-screen relative">
      <div className="fixed inset-0 z-0">
        {/* camera z closer (4) to make model look nearer */}
        <Canvas camera={{ position: [0, 1.6, 4], fov: 50 }} className="w-full h-full">
          <Suspense fallback={<Html center>Loading 3D...</Html>}>
            <ScrollControls pages={4} damping={8}>
              <SceneWithAutoTargets pointerX={pointerX} />
            </ScrollControls>
          </Suspense>
        </Canvas>
      </div>

      <main className="relative z-10 text-white" style={{ touchAction: "pan-y" }}>
        <header className="p-6">
          <h1 className="text-2xl font-semibold">3D Anatomy — Interactive Rotate</h1>
          <p className="text-sm text-white/80">Move cursor left/right or swipe to rotate the model subtly.</p>
        </header>

        <section className="h-screen flex items-center justify-center">
          <div className="max-w-2xl p-8 bg-black/40 rounded-lg">
            <h2 className="text-xl font-bold">Head & Brain</h2>
            <p className="mt-2 text-sm">This should focus near the top of the model.</p>
          </div>
        </section>

        <section className="h-screen flex items-center justify-center">
          <div className="max-w-2xl p-8 bg-black/40 rounded-lg">
            <h2 className="text-xl font-bold">Torso & Organs</h2>
            <p className="mt-2 text-sm">Torso area.</p>
          </div>
        </section>

        <section className="h-screen flex items-center justify-center">
          <div className="max-w-2xl p-8 bg-black/40 rounded-lg">
            <h2 className="text-xl font-bold">Arms & Limbs</h2>
            <p className="mt-2 text-sm">Upper / lower limbs.</p>
          </div>
        </section>

        <section className="h-screen flex items-center justify-center">
          <div className="max-w-2xl p-8 bg-black/40 rounded-lg">
            <h2 className="text-xl font-bold">Legs & Feet</h2>
            <p className="mt-2 text-sm">Lower limbs focus.</p>
          </div>
        </section>

        <div className="h-40" />
      </main>

      <div className="fixed bottom-6 right-6 z-20 text-sm text-white/80">Built with Three.js + R3F</div>
    </div>
  );
}