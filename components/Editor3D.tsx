import React, { useRef, useState, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent, useLoader, useGraph } from '@react-three/fiber';
import { OrbitControls, Line, OrthographicCamera, MapControls, PointerLockControls, Merged } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import * as THREE from 'three';
import { 
    createNoiseTexture, 
    initMasterData, 
    applyBrushOptimized,
    applyShapeToHeightmap,
    applyMountainToHeightmap,
    generateScatterPoints,
    exportHeightmapToImage,
    exportColorMapToImage,
    getTerrainHeightAtWorldPos,
    CHUNK_SIZE,
    SeededRandom,
    applySubtractionToHeightmap
} from '../utils/generation';

// Types
export type ToolMode = 'raise' | 'lower' | 'level' | 'paint' | 'water' | 'layout' | 'mountain' | 'scatter' | 'objects';
export type BrushConfig = {
  size: number;
  strength: number;
  height: number;
  color: string; // Hex
};

export type ShapeConfig = {
    height: number;
    falloff: number;
    noiseStrength: number;
};

export type MountainConfig = {
    height: number;
    width: number;
    ridgeNoise: number;
    flankNoise: number;
}

export type ScatterConfig = {
    count: number;
    minScale: number;
    maxScale: number;
    yOffset: number;
    modelUrl: string | null;
    seed: number;
}

export interface SpatialObject {
    id: string;
    type: 'cube' | 'sphere' | 'cylinder' | 'custom';
    position: [number, number, number];
    scale: [number, number, number];
    rotation?: [number, number, number];
    color: string;
    textureUrl?: string | null;
    customGeometry?: THREE.BufferGeometry;
}

export type TerrainData = {
    heightData: Float32Array;
    colorData: Float32Array;
} | null;

export interface EditorHandle {
    exportHeightmap: () => void;
    exportTexture: () => void;
    carveWithPrimitive: (position: [number, number, number], scale: [number, number, number], type: 'cube' | 'sphere' | 'cylinder' | 'custom') => void;
}

export interface ScatterGroup {
    id: string;
    modelUrl: string;
    points: THREE.Vector3[]; 
    config: ScatterConfig;
    instances: { position: THREE.Vector3, rotation: THREE.Euler, scale: number }[];
}

interface Editor3DProps {
  resolution: 256 | 512 | 1024; 
  mapSize: number; 
  toolMode: ToolMode;
  brush: BrushConfig;
  shapeConfig: ShapeConfig;
  mountainConfig?: MountainConfig;
  scatterConfig?: ScatterConfig;
  spatialObjects: SpatialObject[];
  selectedObjectId: string | null;
  onSelectObject: (id: string | null) => void;
  waterLevel: number;
  isViewMode: boolean; 
  isTestMode: boolean; 
  onTestModeExit: () => void;
  isSpectatorMode: boolean;
  onSpectatorModeExit: () => void; 
  terrainData: TerrainData; 
  shapePoints: THREE.Vector3[];
  onShapeAddPoint: (p: THREE.Vector3) => void;
  shouldApplyShape: boolean; 
  onShapeApplied: (newGroup?: ScatterGroup) => void; 
  view2D?: boolean; 
  editorRef?: React.MutableRefObject<EditorHandle | null>;
  scatterGroups: ScatterGroup[]; 
  selectedScatterId: string | null;
  onSelectScatterGroup: (id: string | null) => void;
}

const SpectatorController = ({ enabled, onExit }: { enabled: boolean, onExit: () => void }) => {
    const { camera } = useThree();
    const [movement, setMovement] = useState({ w: false, a: false, s: false, d: false, q: false, e: false, shift: false });
    
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            switch(e.key.toLowerCase()) {
                case 'w': setMovement(m => ({ ...m, w: true })); break;
                case 'a': setMovement(m => ({ ...m, a: true })); break;
                case 's': setMovement(m => ({ ...m, s: true })); break;
                case 'd': setMovement(m => ({ ...m, d: true })); break;
                case 'q': setMovement(m => ({ ...m, q: true })); break;
                case 'e': setMovement(m => ({ ...m, e: true })); break;
                case 'shift': setMovement(m => ({ ...m, shift: true })); break;
            }
            if (e.code === 'Escape') onExit();
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            switch(e.key.toLowerCase()) {
                case 'w': setMovement(m => ({ ...m, w: false })); break;
                case 'a': setMovement(m => ({ ...m, a: false })); break;
                case 's': setMovement(m => ({ ...m, s: false })); break;
                case 'd': setMovement(m => ({ ...m, d: false })); break;
                case 'q': setMovement(m => ({ ...m, q: false })); break;
                case 'e': setMovement(m => ({ ...m, e: false })); break;
                case 'shift': setMovement(m => ({ ...m, shift: false })); break;
            }
        };
        if (enabled) {
            window.addEventListener('keydown', handleKeyDown);
            window.addEventListener('keyup', handleKeyUp);
        }
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [enabled, onExit]);

    useFrame((state, delta) => {
        if (!enabled) return;
        const baseSpeed = movement.shift ? 40 : 15;
        const speed = baseSpeed * delta;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0);
        const moveDir = new THREE.Vector3();
        if (movement.w) moveDir.add(forward);
        if (movement.s) moveDir.sub(forward);
        if (movement.d) moveDir.add(right);
        if (movement.a) moveDir.sub(right);
        if (movement.q) moveDir.add(up);
        if (movement.e) moveDir.sub(up);
        if (moveDir.lengthSq() > 0) {
            moveDir.normalize().multiplyScalar(speed);
            camera.position.add(moveDir);
        }
    });
    return enabled ? <PointerLockControls /> : null;
}

const FirstPersonController = ({ enabled, heightData, resolution, mapSize, onExit }: { enabled: boolean, heightData: Float32Array | null, resolution: number, mapSize: number, onExit: () => void }) => {
    const { camera } = useThree();
    const [movement, setMovement] = useState({ w: false, a: false, s: false, d: false });
    const speed = 12; 
    const playerHeight = 1.7; 

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            switch(e.key.toLowerCase()) {
                case 'w': setMovement(m => ({ ...m, w: true })); break;
                case 'a': setMovement(m => ({ ...m, a: true })); break;
                case 's': setMovement(m => ({ ...m, s: true })); break;
                case 'd': setMovement(m => ({ ...m, d: true })); break;
            }
            if (e.code === 'Escape') onExit();
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            switch(e.key.toLowerCase()) {
                case 'w': setMovement(m => ({ ...m, w: false })); break;
                case 'a': setMovement(m => ({ ...m, a: false })); break;
                case 's': setMovement(m => ({ ...m, s: false })); break;
                case 'd': setMovement(m => ({ ...m, d: false })); break;
            }
        };
        if (enabled) {
            window.addEventListener('keydown', handleKeyDown);
            window.addEventListener('keyup', handleKeyUp);
        }
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [enabled, onExit]);

    useFrame((state, delta) => {
        if (!enabled || !heightData) return;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        forward.y = 0; forward.normalize();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        right.y = 0; right.normalize();
        const moveDir = new THREE.Vector3();
        if (movement.w) moveDir.add(forward);
        if (movement.s) moveDir.sub(forward);
        if (movement.d) moveDir.add(right);
        if (movement.a) moveDir.sub(right);
        if (moveDir.lengthSq() > 0) {
            moveDir.normalize().multiplyScalar(speed * delta);
            camera.position.add(moveDir);
        }
        const terrainH = getTerrainHeightAtWorldPos(camera.position.x, camera.position.z, heightData, resolution, mapSize);
        camera.position.y = terrainH + playerHeight;
    });
    return enabled ? <PointerLockControls /> : null;
}

const RTSControls = ({ enabled, isViewMode, view2D }: { enabled: boolean; isViewMode: boolean; view2D?: boolean }) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const [movement, setMovement] = useState({ w: false, a: false, s: false, d: false, f: false, g: false });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch(e.key.toLowerCase()) {
        case 'w': setMovement(m => ({ ...m, w: true })); break;
        case 'a': setMovement(m => ({ ...m, a: true })); break;
        case 's': setMovement(m => ({ ...m, s: true })); break;
        case 'd': setMovement(m => ({ ...m, d: true })); break;
        case 'f': setMovement(m => ({ ...m, f: true })); break; 
        case 'g': setMovement(m => ({ ...m, g: true })); break; 
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      switch(e.key.toLowerCase()) {
        case 'w': setMovement(m => ({ ...m, w: false })); break;
        case 'a': setMovement(m => ({ ...m, a: false })); break;
        case 's': setMovement(m => ({ ...m, s: false })); break;
        case 'd': setMovement(m => ({ ...m, d: false })); break;
        case 'f': setMovement(m => ({ ...m, f: false })); break; 
        case 'g': setMovement(m => ({ ...m, g: false })); break; 
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useFrame((state, delta) => {
    if (!enabled || !controlsRef.current || view2D) return; 
    const baseSpeed = 35;
    const speed = baseSpeed * delta; 
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0; right.normalize();
    const moveDir = new THREE.Vector3();
    if (movement.w) moveDir.add(forward);
    if (movement.s) moveDir.sub(forward);
    if (movement.d) moveDir.add(right);
    if (movement.a) moveDir.sub(right);
    if (movement.f) moveDir.y += 1;
    if (movement.g) moveDir.y -= 1;
    if (moveDir.lengthSq() > 0) {
      moveDir.normalize().multiplyScalar(speed);
      camera.position.add(moveDir);
      controlsRef.current.target.add(moveDir);
    }
  });

  return view2D ? (
    <MapControls ref={controlsRef} makeDefault enableRotate={false} enableZoom={false} enablePan={false} screenSpacePanning={false} dampingFactor={0} />
  ) : (
    <OrbitControls ref={controlsRef} makeDefault maxPolarAngle={Math.PI / 2 - 0.1} enabled={enabled} enableDamping={true} dampingFactor={0.1} mouseButtons={{ LEFT: isViewMode ? THREE.MOUSE.ROTATE : -1 as any, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }} />
  );
};

const BrushCursor = ({ position, size, visible }: { position: THREE.Vector3; size: number; visible: boolean }) => {
  if (!visible) return null;
  return (
    // @ts-ignore
    <group position={[position.x, position.y + 0.5, position.z]}>
        {/* @ts-ignore */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
            {/* @ts-ignore */}
            <ringGeometry args={[size * 0.98, size, 4]} /> 
            {/* @ts-ignore */}
            <meshBasicMaterial color="#ffffff" opacity={0.5} transparent side={THREE.DoubleSide} />
        {/* @ts-ignore */}
        </mesh>
    {/* @ts-ignore */}
    </group>
  );
};

const ShapeEditor = ({ points, visible, mode }: { points: THREE.Vector3[], visible: boolean, mode: ToolMode }) => {
    if (!visible || points.length === 0) return null;
    const isLoop = mode === 'layout' || mode === 'scatter';
    let color = mode === 'mountain' ? '#e2e2e2' : mode === 'scatter' ? '#ffffff' : '#7a7a7a';
    const linePoints = useMemo(() => {
        const pts = points.map(p => p.clone().add(new THREE.Vector3(0, 1.5, 0))); 
        if (isLoop && points.length > 2) pts.push(pts[0].clone().add(new THREE.Vector3(0, 1.5, 0))); 
        return pts;
    }, [points, isLoop]);
    return (
        // @ts-ignore
        <group>
            <Line points={linePoints} color={color} lineWidth={1.5} depthTest={false} />
            {points.map((p, i) => (
                // @ts-ignore
                <group key={i} position={[p.x, p.y + 1.5, p.z]}>
                    {/* @ts-ignore */}
                    <mesh rotation={[0, Math.PI/4, 0]}>
                        {/* @ts-ignore */}
                        <boxGeometry args={[1, 0.2, 0.2]} />
                        {/* @ts-ignore */}
                        <meshBasicMaterial color={color} depthTest={false} />
                    {/* @ts-ignore */}
                    </mesh>
                {/* @ts-ignore */}
                </group>
            ))}
        {/* @ts-ignore */}
        </group>
    )
}

const InstancedScatteredModel: React.FC<{ modelUrl: string; instances: any[]; isSelected: boolean; onSelect: () => void }> = React.memo(({ modelUrl, instances, isSelected, onSelect }) => {
    const { scene } = useLoader(GLTFLoader, modelUrl);
    const meshes = useMemo(() => {
        const meshList: Record<string, THREE.Mesh> = {};
        let count = 0;
        scene.updateMatrixWorld(true);
        scene.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
                const originalMesh = obj as THREE.Mesh;
                const geometry = originalMesh.geometry.clone();
                geometry.applyMatrix4(originalMesh.matrixWorld);
                const material = (originalMesh.material as THREE.Material).clone();
                const mesh = new THREE.Mesh(geometry, material);
                meshList[`mesh_${count}`] = mesh;
                const m = material as THREE.MeshStandardMaterial;
                if(m && m.isMeshStandardMaterial) {
                    m.roughness = 1; m.metalness = 0;
                    const hsl = { h: 0, s: 0, l: 0 };
                    m.color.getHSL(hsl);
                    m.color.setHSL(hsl.h, hsl.s * 0.4, hsl.l);
                }
                count++;
            }
        });
        return meshList;
    }, [scene]);
    return (
        <Merged meshes={meshes}>
            {(models: any) => (
                // @ts-ignore
                <group onClick={(e) => { e.stopPropagation(); onSelect(); }}>
                    {instances.map((data, i) => (
                        // @ts-ignore
                        <group key={i} position={data.position} rotation={data.rotation} scale={data.scale}>
                            {Object.keys(meshes).map((key) => {
                                const Model = models[key];
                                return <Model key={key} />;
                            })}
                        {/* @ts-ignore */}
                        </group>
                    ))}
                {/* @ts-ignore */}
                </group>
            )}
        </Merged>
    );
});

const TerrainChunk: React.FC<{ chunkX: number, chunkY: number, globalRes: number, worldSize: number, chunksPerSide: number, heightData: Float32Array, colorData: Float32Array, version: number, material: THREE.Material, view2D?: boolean }> = ({ chunkX, chunkY, globalRes, worldSize, chunksPerSide, heightData, colorData, version, material, view2D }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const { camera } = useThree();
    const worldX = (chunkX * CHUNK_SIZE) - (worldSize / 2) + (CHUNK_SIZE / 2);
    const worldZ = (chunkY * CHUNK_SIZE) - (worldSize / 2) + (CHUNK_SIZE / 2);
    const [lodRes, setLodRes] = useState(8); 

    useFrame(() => {
        if (!meshRef.current || view2D) return;
        const dist = camera.position.distanceTo(new THREE.Vector3(worldX, 0, worldZ));
        let targetRes = dist < 150 ? 48 : dist < 300 ? 24 : 6;
        if (targetRes !== lodRes) setLodRes(targetRes);
    });

    useLayoutEffect(() => {
        if (!meshRef.current) return;
        const segments = lodRes;
        const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, segments, segments);
        const posAttr = geometry.attributes.position;
        const colAttr = new Float32Array(posAttr.count * 3);
        const verticesPerChunk = globalRes / chunksPerSide; 
        const startGX = chunkX * verticesPerChunk;
        const startGY = chunkY * verticesPerChunk;
        const step = verticesPerChunk / segments; 

        for (let i = 0; i < posAttr.count; i++) {
            const lx = i % (segments + 1); const ly = Math.floor(i / (segments + 1));
            const safeGX = Math.max(0, Math.min(globalRes - 1, Math.floor(startGX + (lx * step))));
            const safeGY = Math.max(0, Math.min(globalRes - 1, Math.floor(startGY + (ly * step))));
            const globalIdx = safeGY * globalRes + safeGX;
            posAttr.setZ(i, heightData[globalIdx]);
            colAttr[i * 3] = colorData[globalIdx * 3];
            colAttr[i * 3 + 1] = colorData[globalIdx * 3 + 1];
            colAttr[i * 3 + 2] = colorData[globalIdx * 3 + 2];
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colAttr, 3));
        geometry.computeVertexNormals();
        meshRef.current.geometry.dispose();
        meshRef.current.geometry = geometry;
    }, [lodRes, version, globalRes, chunkX, chunkY, worldSize, chunksPerSide]); 

    // @ts-ignore
    return <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[worldX, 0, worldZ]} receiveShadow castShadow material={material} />;
};

// Componente isolado para carregar textura de forma segura
// Fix: Use primitive and useMemo to avoid JSX.IntrinsicElements errors for material elements
const TexturedMaterial = ({ url, color }: { url: string, color: string }) => {
    const texture = useLoader(THREE.TextureLoader, url);
    const material = useMemo(() => {
        const mat = new THREE.MeshPhongMaterial({ color: "#ffffff", shininess: 30 });
        if (texture) {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.needsUpdate = true;
            mat.map = texture;
        }
        return mat;
    }, [texture]);
    
    useLayoutEffect(() => {
        if (texture) {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.needsUpdate = true;
        }
    }, [texture]);
    
    // @ts-ignore - Fix: primitive element is not in standard JSX elements but valid in React Three Fiber
    return <primitive object={material} attach="material" />;
};

const RenderSpatialObject: React.FC<{ obj: SpatialObject, isSelected: boolean, onSelect: () => void }> = ({ obj, isSelected, onSelect }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    
    // Fix: Using useMemo to create material objects and primitive to render them, avoiding intrinsic element issues
    const materialColor = isSelected ? "#ffffff" : obj.color;
    const basicMaterial = useMemo(() => new THREE.MeshPhongMaterial({ color: materialColor, shininess: 30 }), [materialColor]);
    const fallbackMaterial = useMemo(() => new THREE.MeshPhongMaterial({ color: obj.color }), [obj.color]);

    useEffect(() => {
        if (obj.type === 'custom' && obj.customGeometry && meshRef.current) {
            meshRef.current.geometry = obj.customGeometry;
        }
    }, [obj.customGeometry]);

    return (
        // @ts-ignore
        <group position={obj.position} scale={obj.scale} rotation={obj.rotation || [0, 0, 0]} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
            {/* @ts-ignore */}
            <mesh ref={meshRef}>
                {/* @ts-ignore */}
                {obj.type === 'cube' && <boxGeometry args={[1, 1, 1]} />}
                {/* @ts-ignore */}
                {obj.type === 'sphere' && <sphereGeometry args={[0.5, 32, 32]} />}
                {/* @ts-ignore */}
                {obj.type === 'cylinder' && <cylinderGeometry args={[0.5, 0.5, 1, 32]} />}
                
                {obj.textureUrl ? (
                    // @ts-ignore - Fix: primitive element error in JSX property
                    <React.Suspense fallback={<primitive object={fallbackMaterial} attach="material" />}>
                        <TexturedMaterial url={obj.textureUrl} color={obj.color} />
                    </React.Suspense>
                ) : (
                    // @ts-ignore - Fix: primitive element error in JSX property
                    <primitive object={basicMaterial} attach="material" />
                )}
            {/* @ts-ignore */}
            </mesh>
            {isSelected && (
                // @ts-ignore
                <mesh scale={[1.05, 1.05, 1.05]}>
                    {/* @ts-ignore */}
                    {obj.type === 'cube' && <boxGeometry args={[1, 1, 1]} />}
                    {/* @ts-ignore */}
                    {obj.type === 'sphere' && <sphereGeometry args={[0.5, 32, 32]} />}
                    {/* @ts-ignore */}
                    {obj.type === 'cylinder' && <cylinderGeometry args={[0.5, 0.5, 1, 32]} />}
                    {/* @ts-ignore */}
                    {obj.type === 'custom' && obj.customGeometry && <primitive object={obj.customGeometry} attach="geometry" />}
                    {/* @ts-ignore */}
                    <meshBasicMaterial color="#ffffff" wireframe />
                {/* @ts-ignore */}
                </mesh>
            )}
        {/* @ts-ignore */}
        </group>
    );
};

const TerrainSystem = (props: Editor3DProps & { onInteract: (active: boolean) => void }) => {
  const heightMapRef = useRef<Float32Array>(null!);
  const colorMapRef = useRef<Float32Array>(null!);
  const [hoverPos, setHoverPos] = useState<THREE.Vector3 | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [chunkVersions, setChunkVersions] = useState<Record<string, number>>({});
  const [initVersion, setInitVersion] = useState(0); 
  const chunksPerSide = props.mapSize / CHUNK_SIZE;

  const sharedMaterial = useMemo(() => new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 2, specular: new THREE.Color(0x555555), map: createNoiseTexture() }), []);

  useMemo(() => {
      if (props.terrainData) {
          heightMapRef.current = props.terrainData.heightData;
          colorMapRef.current = props.terrainData.colorData;
      } else {
          const { heightData, colorData } = initMasterData(props.resolution);
          heightMapRef.current = heightData;
          colorMapRef.current = colorData;
      }
      setChunkVersions({}); setInitVersion(v => v + 1);
  }, [props.resolution, props.mapSize, props.terrainData]); 

  useEffect(() => {
    if(props.editorRef) {
        props.editorRef.current = {
            exportHeightmap: () => {
                if(heightMapRef.current) exportHeightmapToImage(heightMapRef.current, props.resolution);
            },
            exportTexture: () => {
                if(colorMapRef.current) exportColorMapToImage(colorMapRef.current, props.resolution);
            },
            carveWithPrimitive: (position, scale, type) => {
                // If custom, carve logic needs adjustment or is skipped for now
                if (type === 'custom') return;
                const dirty = applySubtractionToHeightmap(
                    heightMapRef.current,
                    colorMapRef.current,
                    props.resolution,
                    props.mapSize,
                    position,
                    scale,
                    type as any
                );
                if (dirty.size > 0) setChunkVersions(prev => {
                    const next = { ...prev };
                    dirty.forEach(id => next[id] = (next[id] || 0) + 1);
                    return next;
                });
            }
        }
    }
  }, [props.editorRef, props.resolution, props.mapSize]);

  useEffect(() => {
      if (props.shouldApplyShape) {
          let dirtyChunks = new Set<string>();
          if (props.toolMode === 'layout' && props.shapePoints.length >= 3) {
              dirtyChunks = applyShapeToHeightmap(heightMapRef.current, colorMapRef.current, props.resolution, props.mapSize, props.shapePoints, props.shapeConfig);
          } else if (props.toolMode === 'mountain' && props.shapePoints.length >= 2 && props.mountainConfig) {
              dirtyChunks = applyMountainToHeightmap(heightMapRef.current, colorMapRef.current, props.resolution, props.mapSize, props.shapePoints, props.mountainConfig);
          } else if (props.toolMode === 'scatter' && props.shapePoints.length >= 3 && props.scatterConfig?.modelUrl) {
              const rawPoints = generateScatterPoints(props.shapePoints, props.scatterConfig.count, heightMapRef.current, props.resolution, props.mapSize, props.scatterConfig.seed);
              const rng = new SeededRandom(props.scatterConfig.seed);
              const instances = rawPoints.map(p => ({ position: p.position.clone().add(new THREE.Vector3(0, props.scatterConfig!.yOffset, 0)), rotation: p.rotation, scale: props.scatterConfig!.minScale + rng.next() * (props.scatterConfig!.maxScale - props.scatterConfig!.minScale) }));
              props.onShapeApplied({ id: Math.random().toString(36).substr(2, 9), modelUrl: props.scatterConfig.modelUrl!, points: [...props.shapePoints], config: { ...props.scatterConfig }, instances });
              return;
          }
          if (dirtyChunks.size > 0) setChunkVersions(prev => { const next = { ...prev }; dirtyChunks.forEach(id => next[id] = (next[id] || 0) + 1); return next; });
          props.onShapeApplied();
      }
  }, [props.shouldApplyShape]);

  const handlePointer = useCallback((e: ThreeEvent<PointerEvent>, down: boolean) => {
      if (props.isViewMode || props.isTestMode || props.isSpectatorMode || props.toolMode === 'water') return;
      e.stopPropagation(); setHoverPos(e.point);
      if ((props.toolMode === 'layout' || props.toolMode === 'mountain' || props.toolMode === 'scatter') && down && !isDragging) { props.onShapeAddPoint(e.point); return; }
      if (props.toolMode === 'objects') return;
      if (down) { setIsDragging(true); props.onInteract(true); }
      if (down || isDragging) {
          const strength = props.toolMode === 'lower' ? -props.brush.strength : props.brush.strength;
          const mode = props.toolMode === 'paint' ? 'paint' : props.toolMode === 'level' ? 'level' : 'sculpt';
          const dirty = applyBrushOptimized(heightMapRef.current, colorMapRef.current, props.resolution, props.mapSize, e.point, props.brush.size, strength, mode, props.brush.height, props.brush.color);
          if (dirty.size > 0) setChunkVersions(prev => { const next = { ...prev }; dirty.forEach(id => next[id] = (next[id] || 0) + 1); return next; });
      }
  }, [isDragging, props]);

  const chunks = useMemo(() => {
      const list = []; const count = props.mapSize / CHUNK_SIZE;
      for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) list.push({ x, y, key: `${x},${y}` });
      return list;
  }, [props.mapSize]);

  return (
    <>
      <FirstPersonController enabled={props.isTestMode} heightData={heightMapRef.current} resolution={props.resolution} mapSize={props.mapSize} onExit={props.onTestModeExit} />
      <SpectatorController enabled={props.isSpectatorMode} onExit={props.onSpectatorModeExit} />
      {/* @ts-ignore */}
      <mesh visible={false} rotation={[-Math.PI / 2, 0, 0]} onPointerMove={(e) => isDragging || props.view2D ? handlePointer(e, false) : setHoverPos(e.point)} onPointerDown={(e) => handlePointer(e, true)} onPointerUp={() => { setIsDragging(false); props.onInteract(false); }} onPointerLeave={() => setHoverPos(null)}>
          {/* @ts-ignore */}
          <planeGeometry args={[props.mapSize, props.mapSize]} />
      {/* @ts-ignore */}
      </mesh>
      {/* @ts-ignore */}
      <group key={initVersion}>
          {chunks.map(c => <TerrainChunk key={c.key} chunkX={c.x} chunkY={c.y} globalRes={props.resolution} worldSize={props.mapSize} chunksPerSide={chunksPerSide} heightData={heightMapRef.current} colorData={colorMapRef.current} version={chunkVersions[c.key] || 0} material={sharedMaterial} view2D={props.view2D} />)}
      {/* @ts-ignore */}
      </group>
      {/* @ts-ignore */}
      <group>{props.spatialObjects.map(obj => <RenderSpatialObject key={obj.id} obj={obj} isSelected={props.selectedObjectId === obj.id} onSelect={() => props.onSelectObject(obj.id)} />)}</group>
      <React.Suspense fallback={null}>{props.scatterGroups.map(g => <InstancedScatteredModel key={g.id} modelUrl={g.modelUrl} instances={g.instances} isSelected={props.selectedScatterId === g.id} onSelect={() => props.onSelectScatterGroup(g.id)} />)}</React.Suspense>
      {hoverPos && !props.isViewMode && !props.isTestMode && !props.isSpectatorMode && !props.view2D && props.toolMode !== 'water' && props.toolMode !== 'objects' && <BrushCursor position={hoverPos} size={props.brush.size} visible={true} />}
      <ShapeEditor points={props.shapePoints} visible={true} mode={props.toolMode} />
    </>
  );
};

// Fix: Use primitive and useMemo for Water material
const Water = ({ level, mapSize }: { level: number, mapSize: number }) => {
  const waterMaterial = useMemo(() => new THREE.MeshPhongMaterial({ color: "#3e4447", transparent: true, opacity: 0.85, shininess: 50, specular: new THREE.Color(0x666666) }), []);
  return (
    // @ts-ignore
    <mesh position={[0, level, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        {/* @ts-ignore */}
        <planeGeometry args={[mapSize, mapSize]} />
        {/* @ts-ignore - Fix: primitive element error in JSX property */}
        <primitive object={waterMaterial} attach="material" />
    {/* @ts-ignore */}
    </mesh>
  );
};

const EditorScene: React.FC<Editor3DProps> = (props) => {
  const [canRotate, setCanRotate] = useState(true);
  const zoom2D = useMemo(() => props.view2D ? 600 / props.mapSize : 5, [props.mapSize, props.view2D]);
  return (
    <Canvas shadows dpr={[1, 1]} gl={{ antialias: false }}> 
      {props.view2D ? (
          // @ts-ignore
          <><color attach="background" args={['#222']} /><OrthographicCamera makeDefault position={[0, 200, 0]} zoom={zoom2D} near={0.1} far={1000} /></>
      ) : (
          // @ts-ignore
          <><color attach="background" args={['#9ca3af']} /><fog attach="fog" args={['#9ca3af', 20, 200]} /><perspectiveCamera position={[60, 45, 60]} fov={80} /></>
      )}
      {/* @ts-ignore */}
      <ambientLight intensity={0.8} color="#ffffff" />
      {/* @ts-ignore */}
      <directionalLight position={[40, 80, 40]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} />
      <TerrainSystem {...props} onInteract={(active) => setCanRotate(!active)} />
      <Water level={props.waterLevel} mapSize={props.mapSize} />
      {!props.isTestMode && !props.isSpectatorMode && <RTSControls enabled={canRotate} isViewMode={props.isViewMode} view2D={props.view2D} />}
      {/* @ts-ignore */}
      <gridHelper args={[props.mapSize, props.mapSize / 16, 0x666666, 0x444444]} position={[0, 0.05, 0]} visible={props.view2D} />
    </Canvas>
  );
};

export default EditorScene;