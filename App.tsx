import React, { useState, useRef, useEffect } from 'react';
import EditorScene, { ToolMode, BrushConfig, ShapeConfig, MountainConfig, ScatterConfig, TerrainData, EditorHandle, ScatterGroup, SpatialObject } from './components/Editor3D';
import { generateTerrainFromImage, SeededRandom, generateScatterPoints } from './utils/generation';
import * as THREE from 'three';
import { CSG } from 'three-csg-ts';
import { 
  Mountain, 
  ArrowDown,
  Paintbrush, 
  Waves, 
  ArrowUpToLine,
  Upload,
  Loader2,
  Spline,
  Check,
  Trash2,
  Undo2,
  ArrowLeft,
  Activity,
  Download,
  Save,
  Trees,
  FileBox,
  Gamepad2,
  RefreshCw,
  Layers,
  X,
  Eye,
  Box,
  Circle,
  Torus,
  Image as ImageIcon,
  Combine,
  Scissors,
  Diamond,
  RotateCw
} from 'lucide-react';

// Conversion helpers
const toRad = (deg: number) => deg * (Math.PI / 180);
const toDeg = (rad: number) => rad * (180 / Math.PI);

const App: React.FC = () => {
  const [resolution, setResolution] = useState<256 | 512 | 1024>(256);
  const [mapSize, setMapSize] = useState<number>(256);
  const [toolMode, setToolMode] = useState<ToolMode>('raise');
  const [waterLevel, setWaterLevel] = useState<number>(0);
  const [isViewMode, setIsViewMode] = useState(false);
  const [isTestMode, setIsTestMode] = useState(false);
  const [isSpectatorMode, setIsSpectatorMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [terrainData, setTerrainData] = useState<TerrainData>(null);
  
  const [scatterGroups, setScatterGroups] = useState<ScatterGroup[]>([]);
  const [selectedScatterId, setSelectedScatterId] = useState<string | null>(null);

  // Spatial Objects state
  const [spatialObjects, setSpatialObjects] = useState<SpatialObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [targetObjectId, setTargetObjectId] = useState<string | null>(null);
  const [movementStep, setMovementStep] = useState(10);
  const [localPos, setLocalPos] = useState({ x: 0, y: 0, z: 0 });
  const [localScale, setLocalScale] = useState({ x: 5, y: 5, z: 5 });
  const [localRot, setLocalRot] = useState({ x: 0, y: 0, z: 0 }); // In degrees for the UI

  const [shapePoints, setShapePoints] = useState<THREE.Vector3[]>([]);
  const [shouldApplyShape, setShouldApplyShape] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const textureInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<EditorHandle>(null);

  const [brush, setBrush] = useState<BrushConfig>({
    size: 6,
    strength: 0.4,
    height: 8,
    color: '#444444' 
  });

  const [shapeConfig, setShapeConfig] = useState<ShapeConfig>({
      height: 15,
      falloff: 15,
      noiseStrength: 0.8
  });

  const [mountainConfig, setMountainConfig] = useState<MountainConfig>({
      height: 35,
      width: 20,
      ridgeNoise: 0.4,
      flankNoise: 0.8
  });

  const [scatterConfig, setScatterConfig] = useState<ScatterConfig>({
      count: 30,
      minScale: 1.0,
      maxScale: 1.5,
      yOffset: 0,
      modelUrl: null,
      seed: 99
  });

  const selectedObject = spatialObjects.find(o => o.id === selectedObjectId);

  useEffect(() => {
    if (selectedObject) {
      setLocalPos({ x: selectedObject.position[0], y: selectedObject.position[1], z: selectedObject.position[2] });
      setLocalScale({ x: selectedObject.scale[0], y: selectedObject.scale[1], z: selectedObject.scale[2] });
      // Convert from radians (internal) to degrees (UI)
      setLocalRot({ 
        x: selectedObject.rotation ? toDeg(selectedObject.rotation[0]) : 0, 
        y: selectedObject.rotation ? toDeg(selectedObject.rotation[1]) : 0, 
        z: selectedObject.rotation ? toDeg(selectedObject.rotation[2]) : 0 
      });
    }
  }, [selectedObjectId]);

  const updateBrush = (key: keyof BrushConfig, value: number | string) => {
    setBrush(prev => ({ ...prev, [key]: value }));
  };

  const updateShapeConfig = (key: keyof ShapeConfig, value: number) => {
    setShapeConfig(prev => ({ ...prev, [key]: value }));
  };

  const updateMountainConfig = (key: keyof MountainConfig, value: number) => {
    setMountainConfig(prev => ({ ...prev, [key]: value }));
  };

  const updateScatterConfig = (key: keyof ScatterConfig, value: any) => {
    setScatterConfig(prev => ({ ...prev, [key]: value }));
  }

  const deleteSelectedGroup = () => {
      if(!selectedScatterId) return;
      setScatterGroups(prev => prev.filter(g => g.id !== selectedScatterId));
      setSelectedScatterId(null);
  }

  const handleSetToolMode = (mode: ToolMode) => {
      setToolMode(mode);
      if (mode === 'layout' || mode === 'mountain' || mode === 'scatter' || mode === 'objects') {
          setIsViewMode(false); 
      }
      if (mode !== 'scatter') setSelectedScatterId(null);
      if (mode !== 'objects') setSelectedObjectId(null);
  };

  const addSpatialObject = (type: 'cube' | 'sphere' | 'cylinder') => {
      const newObj: SpatialObject = {
          id: Math.random().toString(36).substr(2, 9),
          type,
          position: [0, 5, 0],
          scale: [5, 5, 5],
          rotation: [0, 0, 0],
          color: '#cccccc'
      };
      setSpatialObjects(prev => [...prev, newObj]);
      setSelectedObjectId(newObj.id);
  };

  const handleDeleteObject = () => {
    if (!selectedObject) return;
    
    if (editorRef.current) {
        editorRef.current.carveWithPrimitive(
            selectedObject.position,
            selectedObject.scale,
            selectedObject.type
        );
    }

    setSpatialObjects(prev => prev.filter(o => o.id !== selectedObjectId));
    setSelectedObjectId(null);
  };

  const applyObjectTransforms = () => {
      if (!selectedObjectId) return;
      setSpatialObjects(prev => prev.map(o => 
          o.id === selectedObjectId 
          ? { 
              ...o, 
              position: [localPos.x, localPos.y, localPos.z], 
              scale: [localScale.x, localScale.y, localScale.z], 
              // Convert from degrees (UI) back to radians (internal)
              rotation: [toRad(localRot.x), toRad(localRot.y), toRad(localRot.z)] 
            } 
          : o
      ));
  };

  const offsetObjectPos = (axis: 'x' | 'y' | 'z', amount: number) => {
      if (!selectedObjectId) return;
      setLocalPos(prev => {
          const next = { ...prev, [axis]: prev[axis] + amount };
          setSpatialObjects(curr => curr.map(o => 
            o.id === selectedObjectId ? { ...o, position: [next.x, next.y, next.z] } : o
          ));
          return next;
        });
  };

  const offsetObjectScale = (axis: 'x' | 'y' | 'z', amount: number) => {
    if (!selectedObjectId) return;
    setLocalScale(prev => {
        const next = { ...prev, [axis]: Math.max(0.1, prev[axis] + amount) };
        setSpatialObjects(curr => curr.map(o => 
          o.id === selectedObjectId ? { ...o, scale: [next.x, next.y, next.z] } : o
        ));
        return next;
    });
  };

  const offsetObjectRot = (axis: 'x' | 'y' | 'z', amountDeg: number) => {
    if (!selectedObjectId) return;
    setLocalRot(prev => {
        const next = { ...prev, [axis]: (prev[axis] + amountDeg) % 360 };
        setSpatialObjects(curr => curr.map(o => 
          o.id === selectedObjectId ? { ...o, rotation: [toRad(next.x), toRad(next.y), toRad(next.z)] } : o
        ));
        return next;
    });
  };

  const createMeshFromObject = (obj: SpatialObject): THREE.Mesh | null => {
    let geometry: THREE.BufferGeometry;
    if (obj.type === 'cube') {
        geometry = new THREE.BoxGeometry(1, 1, 1);
    } else if (obj.type === 'sphere') {
        geometry = new THREE.SphereGeometry(0.5, 32, 32);
    } else if (obj.type === 'cylinder') {
        geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    } else if (obj.type === 'custom' && obj.customGeometry) {
        geometry = obj.customGeometry.clone();
    } else {
        return null;
    }

    const mesh = new THREE.Mesh(geometry);
    mesh.position.set(obj.position[0], obj.position[1], obj.position[2]);
    mesh.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
    if (obj.rotation) {
        mesh.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2]);
    }
    mesh.updateMatrixWorld();
    return mesh;
  };

  const handleCSGOperation = (op: 'union' | 'intersect' | 'subtract') => {
    if (!selectedObjectId || !targetObjectId || selectedObjectId === targetObjectId) return;
    
    const objA = spatialObjects.find(o => o.id === selectedObjectId);
    const objB = spatialObjects.find(o => o.id === targetObjectId);
    if (!objA || !objB) return;

    const meshA = createMeshFromObject(objA);
    const meshB = createMeshFromObject(objB);
    if (!meshA || !meshB) return;

    meshA.updateMatrixWorld(true);
    meshA.geometry.applyMatrix4(meshA.matrixWorld);
    meshA.position.set(0, 0, 0);
    meshA.rotation.set(0, 0, 0);
    meshA.scale.set(1, 1, 1);
    meshA.updateMatrixWorld(true);

    meshB.updateMatrixWorld(true);
    meshB.geometry.applyMatrix4(meshB.matrixWorld);
    meshB.position.set(0, 0, 0);
    meshB.rotation.set(0, 0, 0);
    meshB.scale.set(1, 1, 1);
    meshB.updateMatrixWorld(true);

    let resultMesh: THREE.Mesh;
    try {
        if (op === 'union') resultMesh = CSG.union(meshA, meshB);
        else if (op === 'intersect') resultMesh = CSG.intersect(meshA, meshB);
        else resultMesh = CSG.subtract(meshA, meshB);
    } catch (e) {
        console.error("CSG Operation Error", e);
        alert("Erro na operação CSG: Verifique se as malhas se interceptam corretamente.");
        return;
    }

    const resultGeom = resultMesh.geometry;
    
    const newObj: SpatialObject = {
        id: 'csg_' + Math.random().toString(36).substr(2, 9),
        type: 'custom',
        position: [0, 0, 0],
        scale: [1, 1, 1],
        rotation: [0, 0, 0],
        color: objA.color,
        customGeometry: resultGeom
    };

    setSpatialObjects(prev => {
        const filtered = prev.filter(o => o.id !== selectedObjectId && o.id !== targetObjectId);
        return [...filtered, newObj];
    });

    setSelectedObjectId(newObj.id);
    setTargetObjectId(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsGenerating(true);
    try {
       const scale = 40;
       const data = await generateTerrainFromImage(file, resolution, scale);
       setTerrainData(data);
       setWaterLevel(1); 
       setScatterGroups([]); 
       setSpatialObjects([]);
    } catch (err) {
       console.error("Failed to generate terrain", err);
       alert("Process error.");
    } finally {
       setIsGenerating(false);
       if(fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleModelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      updateScatterConfig('modelUrl', url);
  }

  const handleTextureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !selectedObjectId) return;
      const url = URL.createObjectURL(file);
      setSpatialObjects(prev => prev.map(o => 
        o.id === selectedObjectId ? { ...o, textureUrl: url } : o
      ));
  }

  const clearObjectTexture = () => {
    if (!selectedObjectId) return;
    setSpatialObjects(prev => prev.map(o => 
        o.id === selectedObjectId ? { ...o, textureUrl: null } : o
    ));
  }

  const isLayoutMode = toolMode === 'layout';
  const isMountainMode = toolMode === 'mountain';
  const isScatterMode = toolMode === 'scatter';
  const isObjectsMode = toolMode === 'objects';
  const is2DMode = isLayoutMode || isMountainMode || isScatterMode;

  const isSidebarHidden = (isViewMode && !is2DMode && !isObjectsMode) || isTestMode || isSpectatorMode;

  return (
    <div className="flex w-full h-screen bg-[#111] text-white overflow-hidden font-mono tracking-tighter">
      
      <aside className={`w-80 bg-[#1a1a1a] border-r border-[#333] flex flex-col shadow-xl z-10 transition-all duration-300 ${isSidebarHidden ? '-ml-80' : ''}`}>
        
        <div className="p-4 border-b border-[#333] bg-[#1a1a1a]">
          <h1 className="text-xl font-bold text-[#777]">
            ASHTERRA_EDITOR
          </h1>
          <p className="text-[10px] text-gray-500 mt-1 uppercase">
              {is2DMode ? 'SCHE_PLANNING' : (isObjectsMode ? 'SPATIAL_OBJECTS' : 'TERR_SCULPT')}
          </p>
        </div>

        {!is2DMode && !isObjectsMode ? (
            <>
                <div className="p-4 grid grid-cols-2 gap-1.5">
                   <button onClick={() => handleSetToolMode('raise')} className={`p-3 rounded border border-[#333] flex flex-col items-center justify-center transition-colors ${toolMode === 'raise' ? 'bg-[#444] text-white border-white' : 'bg-[#222] text-[#666] hover:bg-[#2a2a2a]'}`}>
                     <Mountain size={20} className="mb-1" /> <span className="text-[10px] font-bold">RAISE</span>
                   </button>
                   <button onClick={() => handleSetToolMode('lower')} className={`p-3 rounded border border-[#333] flex flex-col items-center justify-center transition-colors ${toolMode === 'lower' ? 'bg-[#444] text-white border-white' : 'bg-[#222] text-[#666] hover:bg-[#2a2a2a]'}`}>
                     <ArrowDown size={20} className="mb-1" /> <span className="text-[10px] font-bold">LOWER</span>
                   </button>
                   <button onClick={() => handleSetToolMode('level')} className={`p-3 rounded border border-[#333] flex flex-col items-center justify-center transition-colors ${toolMode === 'level' ? 'bg-[#444] text-white border-white' : 'bg-[#222] text-[#666] hover:bg-[#2a2a2a]'}`}>
                     <ArrowUpToLine size={20} className="mb-1" /> <span className="text-[10px] font-bold">LEVEL</span>
                   </button>
                   <button onClick={() => handleSetToolMode('paint')} className={`p-3 rounded border border-[#333] flex flex-col items-center justify-center transition-colors ${toolMode === 'paint' ? 'bg-[#444] text-white border-white' : 'bg-[#222] text-[#666] hover:bg-[#2a2a2a]'}`}>
                     <Paintbrush size={20} className="mb-1" /> <span className="text-[10px] font-bold">STAIN</span>
                   </button>
                   <button onClick={() => handleSetToolMode('water')} className={`p-3 rounded border border-[#333] flex flex-col items-center justify-center transition-colors ${toolMode === 'water' ? 'bg-[#444] text-white border-white' : 'bg-[#222] text-[#666] hover:bg-[#2a2a2a]'}`}>
                     <Waves size={20} className="mb-1" /> <span className="text-[10px] font-bold">FLUID</span>
                   </button>
                   <button onClick={() => handleSetToolMode('objects')} className={`p-3 rounded border border-[#333] flex flex-col items-center justify-center transition-colors ${(toolMode as string) === 'objects' ? 'bg-[#444] text-white border-white' : 'bg-[#222] text-[#666] hover:bg-[#2a2a2a]'}`}>
                     <Box size={20} className="mb-1" /> <span className="text-[10px] font-bold">PRIMITIVES</span>
                   </button>
                   <button onClick={() => setIsTestMode(true)} className={`p-3 rounded border border-[#444] flex flex-col items-center justify-center transition-colors bg-[#222] text-[#888] hover:bg-[#333]`}>
                     <Gamepad2 size={20} className="mb-1" /> <span className="text-[10px] font-bold">WALK</span>
                   </button>
                   <button onClick={() => setIsSpectatorMode(true)} className={`p-3 rounded border border-[#444] flex flex-col items-center justify-center transition-colors bg-[#222] text-[#888] hover:bg-[#333]`}>
                     <Eye size={20} className="mb-1" /> <span className="text-[10px] font-bold">SPECTATE</span>
                   </button>
                   <button onClick={() => handleSetToolMode('layout')} className="p-3 rounded border border-[#333] flex flex-col items-center justify-center transition-colors bg-[#222] text-[#666] hover:bg-[#2a2a2a]">
                     <Spline size={20} className="mb-1" /> <span className="text-[10px] font-bold">LAYOUT</span>
                   </button>
                   <button onClick={() => handleSetToolMode('mountain')} className="p-3 rounded border border-[#333] flex flex-col items-center justify-center transition-colors bg-[#222] text-[#666] hover:bg-[#2a2a2a]">
                     <Activity size={20} className="mb-1" /> <span className="text-[10px] font-bold">PEAK</span>
                   </button>
                   <button onClick={() => handleSetToolMode('scatter')} className="col-span-2 p-3 rounded border border-[#333] flex flex-col items-center justify-center transition-colors bg-[#222] text-[#666] hover:bg-[#2a2a2a]">
                     <Trees size={20} className="mb-1" /> <span className="text-[10px] font-bold">SCATTER_LAYER</span>
                   </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {toolMode === 'water' ? (
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-bold uppercase text-gray-600 tracking-wider">GLOBAL_FLUID_LEVEL</h3>
                            <div className="bg-[#222] p-2 rounded border border-[#333]">
                                <div className="flex justify-between text-[10px] mb-1 text-gray-500">
                                    <span>HEIGHT_</span><span>{waterLevel.toFixed(1)}</span>
                                </div>
                                <input 
                                    type="range" 
                                    min="-20" 
                                    max="50" 
                                    step="0.5" 
                                    value={waterLevel} 
                                    onChange={(e) => setWaterLevel(parseFloat(e.target.value))} 
                                    className="w-full h-1 bg-[#333] rounded-lg appearance-none cursor-pointer accent-gray-400" 
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-bold uppercase text-gray-600 tracking-wider">CONFIG_BRUSH</h3>
                             <div>
                                <div className="flex justify-between text-[10px] mb-1">
                                  <span>RAD_</span> <span>{brush.size.toFixed(0)}</span>
                                </div>
                                <input type="range" min="1" max="25" step="1" value={brush.size} onChange={(e) => updateBrush('size', parseFloat(e.target.value))} className="w-full h-1 bg-[#333] rounded-lg appearance-none cursor-pointer accent-gray-400" />
                            </div>
                             <div>
                                <div className="flex justify-between text-[10px] mb-1">
                                  <span>FOR_</span> <span>{brush.strength.toFixed(2)}</span>
                                </div>
                                <input type="range" min="0.1" max="1.0" step="0.1" value={brush.strength} onChange={(e) => updateBrush('strength', parseFloat(e.target.value))} className="w-full h-1 bg-[#333] rounded-lg appearance-none cursor-pointer accent-gray-400" />
                            </div>
                        </div>
                    )}

                    <div className="pt-6 border-t border-[#333]">
                        <h3 className="text-[10px] font-bold uppercase text-gray-600 tracking-wider mb-3">WORLD_SCALE</h3>
                        <div className="flex gap-2 mb-4">
                            {[256, 1024, 4096].map(size => (
                                <button
                                    key={size}
                                    onClick={() => setMapSize(size)}
                                    className={`flex-1 py-2 text-[10px] border rounded transition-colors ${
                                        mapSize === size 
                                        ? 'bg-[#444] text-white border-white' 
                                        : 'bg-[#222] text-gray-500 border-[#333] hover:bg-[#2a2a2a]'
                                    }`}
                                >
                                    {size === 256 ? 'S (256)' : size === 1024 ? 'M (1K)' : 'L (4K)'}
                                </button>
                            ))}
                        </div>

                        <h3 className="text-[10px] font-bold uppercase text-gray-600 tracking-wider mb-3">DATA_TRANSFER</h3>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => fileInputRef.current?.click()} className="bg-[#222] border border-[#333] text-[10px] py-2 rounded flex items-center justify-center gap-1 hover:bg-[#333]"><Upload size={12} /> IMPORT</button>
                            <button onClick={() => editorRef.current?.exportTexture()} className="bg-[#222] border border-[#333] text-[10px] py-2 rounded flex items-center justify-center gap-1 hover:bg-[#333]"><Download size={12} /> EXPORT</button>
                        </div>
                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                    </div>
                </div>
            </>
        ) : isObjectsMode ? (
            <div className="flex flex-col h-full bg-[#1a1a1a]">
                <div className="p-3 border-b border-[#333] bg-[#1a1a1a]">
                    <button onClick={() => handleSetToolMode('raise')} className="mb-2 flex items-center gap-2 text-[10px] font-bold text-gray-600 hover:text-white transition-colors">
                        <ArrowLeft size={14} /> RETURN_MAIN
                    </button>
                    <h3 className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 text-gray-400">
                        ADD_SPATIAL_PRIMITIVE
                    </h3>
                    <div className="grid grid-cols-3 gap-1 mt-3">
                        <button onClick={() => addSpatialObject('cube')} className="bg-[#222] hover:bg-[#333] border border-[#333] p-2 rounded flex flex-col items-center">
                            <Box size={16} /> <span className="text-[8px] mt-1">CUBE</span>
                        </button>
                        <button onClick={() => addSpatialObject('sphere')} className="bg-[#222] hover:bg-[#333] border border-[#333] p-2 rounded flex flex-col items-center">
                            <Circle size={16} /> <span className="text-[8px] mt-1">SPHERE</span>
                        </button>
                        <button onClick={() => addSpatialObject('cylinder')} className="bg-[#222] hover:bg-[#333] border border-[#333] p-2 rounded flex flex-col items-center">
                            <Torus size={16} /> <span className="text-[8px] mt-1">CYL</span>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                    {spatialObjects.length > 0 && (
                        <div>
                            <h4 className="text-[10px] font-bold text-gray-600 mb-2 uppercase">ACTIVE_PRIMITIVES</h4>
                            <div className="max-h-32 overflow-y-auto space-y-1 bg-[#111] p-1 rounded border border-[#333]">
                                {spatialObjects.map(obj => (
                                    <div 
                                        key={obj.id}
                                        onClick={() => setSelectedObjectId(obj.id)}
                                        className={`text-[10px] p-2 rounded cursor-pointer flex justify-between items-center ${selectedObjectId === obj.id ? 'bg-[#444] text-white' : 'bg-[#222] text-[#555] hover:bg-[#2a2a2a]'}`}
                                    >
                                        <span>{obj.type.toUpperCase()}_{obj.id.substring(0,4)}</span>
                                        {selectedObjectId === obj.id && (
                                            <button onClick={(e) => { e.stopPropagation(); setSpatialObjects(p => p.filter(o => o.id !== obj.id)); setSelectedObjectId(null); }} className="hover:text-red-500"><Trash2 size={12}/></button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {selectedObject && (
                        <div className="space-y-4 pb-10">
                            {/* CSG Panel */}
                            {spatialObjects.length > 1 && (
                                <div className="bg-[#222] p-3 rounded-sm border border-[#333] text-white">
                                    <h4 className="text-[10px] font-bold mb-2 uppercase text-blue-400 flex items-center gap-1"><Combine size={12}/> OPERAÇÕES_BOOLEANAS</h4>
                                    <p className="text-[8px] opacity-60 mb-2">SELECIONE UM ALVO PARA OPERAR COM O OBJETO ATUAL.</p>
                                    <select 
                                        value={targetObjectId || ''} 
                                        onChange={(e) => setTargetObjectId(e.target.value)}
                                        className="w-full bg-[#111] border border-[#444] text-[10px] p-1.5 rounded mb-3 outline-none"
                                    >
                                        <option value="">-- SELECIONAR_ALVO --</option>
                                        {spatialObjects.filter(o => o.id !== selectedObjectId).map(o => (
                                            <option key={o.id} value={o.id}>{o.type.toUpperCase()}_{o.id.substring(0,4)}</option>
                                        ))}
                                    </select>
                                    
                                    <div className="grid grid-cols-3 gap-1">
                                        <button 
                                            disabled={!targetObjectId}
                                            onClick={() => handleCSGOperation('union')}
                                            className={`p-2 rounded border border-[#333] flex flex-col items-center justify-center transition-all ${targetObjectId ? 'bg-[#333] hover:bg-[#444] text-green-400' : 'opacity-20 cursor-not-allowed'}`}
                                        >
                                            <Combine size={14} /> <span className="text-[7px] mt-1 font-bold">UNIÃO</span>
                                        </button>
                                        <button 
                                            disabled={!targetObjectId}
                                            onClick={() => handleCSGOperation('subtract')}
                                            className={`p-2 rounded border border-[#333] flex flex-col items-center justify-center transition-all ${targetObjectId ? 'bg-[#333] hover:bg-[#444] text-red-400' : 'opacity-20 cursor-not-allowed'}`}
                                        >
                                            <Scissors size={14} /> <span className="text-[7px] mt-1 font-bold">DIFERENÇA</span>
                                        </button>
                                        <button 
                                            disabled={!targetObjectId}
                                            onClick={() => handleCSGOperation('intersect')}
                                            className={`p-2 rounded border border-[#333] flex flex-col items-center justify-center transition-all ${targetObjectId ? 'bg-[#333] hover:bg-[#444] text-blue-400' : 'opacity-20 cursor-not-allowed'}`}
                                        >
                                            <Diamond size={14} /> <span className="text-[7px] mt-1 font-bold">INTERSEC</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* LOCALIZAÇÃO Panel */}
                            <div className="bg-[#bbb] p-3 rounded-sm shadow-inner text-black font-sans">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-[12px] font-bold flex items-center uppercase">LOCALIZAÇÃO <span className="ml-1 text-[8px]">▼</span></div>
                                    <div className="bg-[#eee] px-2 py-0.5 border border-black/20 text-[14px] font-bold flex items-center">
                                        <input 
                                            type="number" 
                                            value={movementStep} 
                                            onChange={(e) => setMovementStep(parseFloat(e.target.value))} 
                                            className="bg-transparent w-8 outline-none text-right mr-1" 
                                        /> <span className="text-[10px]">▼</span>
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-3 gap-2 text-center text-[11px] mb-2 font-bold text-gray-700">
                                    <span>X</span> <span>Y</span> <span>Z</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 mb-3">
                                    <input type="number" value={localPos.x.toFixed(1)} onChange={(e) => setLocalPos({...localPos, x: parseFloat(e.target.value)})} className="bg-[#eee] p-1 border border-black/20 text-[14px] font-bold text-center outline-none" />
                                    <input type="number" value={localPos.y.toFixed(1)} onChange={(e) => setLocalPos({...localPos, y: parseFloat(e.target.value)})} className="bg-[#eee] p-1 border border-black/20 text-[14px] font-bold text-center outline-none" />
                                    <input type="number" value={localPos.z.toFixed(1)} onChange={(e) => setLocalPos({...localPos, z: parseFloat(e.target.value)})} className="bg-[#eee] p-1 border border-black/20 text-[14px] font-bold text-center outline-none" />
                                </div>

                                <button onClick={applyObjectTransforms} className="w-full bg-[#eee] border-2 border-green-800/30 rounded-full py-1 text-[13px] font-bold mb-4 shadow-sm hover:bg-white active:scale-95 transition-all">APLICAR</button>

                                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                                    <button onClick={() => offsetObjectPos('x', movementStep)} className="bg-red-400/80 p-2 rounded-xl border border-red-900/30 text-[14px] font-bold text-black shadow-md active:bg-red-500">L+X</button>
                                    <button onClick={() => offsetObjectPos('x', -movementStep)} className="bg-red-400/80 p-2 rounded-xl border border-red-900/30 text-[14px] font-bold text-black shadow-md active:bg-red-500">L-X</button>
                                    <button onClick={() => offsetObjectPos('y', movementStep)} className="bg-green-400/80 p-2 rounded-xl border border-green-900/30 text-[14px] font-bold text-black shadow-md active:bg-green-500">L+Y</button>
                                    <button onClick={() => offsetObjectPos('y', -movementStep)} className="bg-green-400/80 p-2 rounded-xl border border-green-900/30 text-[14px] font-bold text-black shadow-md active:bg-green-500">L-Y</button>
                                    <button onClick={() => offsetObjectPos('z', movementStep)} className="bg-blue-400/80 p-2 rounded-xl border border-blue-900/30 text-[14px] font-bold text-black shadow-md active:bg-blue-500">L+Z</button>
                                    <button onClick={() => offsetObjectPos('z', -movementStep)} className="bg-blue-400/80 p-2 rounded-xl border border-blue-900/30 text-[14px] font-bold text-black shadow-md active:bg-blue-500">L-Z</button>
                                </div>
                            </div>

                            {/* ROTAÇÃO Panel (In Degrees) */}
                            <div className="bg-[#aaa] p-3 rounded-sm shadow-inner text-black font-sans">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-[12px] font-bold flex items-center uppercase">ROTAÇÃO (GRAUS) <span className="ml-1 text-[8px]">▼</span></div>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center text-[11px] mb-2 font-bold text-gray-700">
                                    <span>X°</span> <span>Y°</span> <span>Z°</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 mb-3">
                                    <input type="number" value={localRot.x.toFixed(0)} onChange={(e) => setLocalRot({...localRot, x: parseFloat(e.target.value)})} className="bg-[#eee] p-1 border border-black/20 text-[14px] font-bold text-center outline-none" />
                                    <input type="number" value={localRot.y.toFixed(0)} onChange={(e) => setLocalRot({...localRot, y: parseFloat(e.target.value)})} className="bg-[#eee] p-1 border border-black/20 text-[14px] font-bold text-center outline-none" />
                                    <input type="number" value={localRot.z.toFixed(0)} onChange={(e) => setLocalRot({...localRot, z: parseFloat(e.target.value)})} className="bg-[#eee] p-1 border border-black/20 text-[14px] font-bold text-center outline-none" />
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-2">
                                    <button onClick={() => offsetObjectRot('x', 15)} className="bg-yellow-400/80 p-2 rounded-xl border border-yellow-900/30 text-[14px] font-bold text-black shadow-md active:bg-yellow-500 flex items-center justify-center gap-1"><RotateCw size={14}/> R+X</button>
                                    <button onClick={() => offsetObjectRot('x', -15)} className="bg-yellow-400/80 p-2 rounded-xl border border-yellow-900/30 text-[14px] font-bold text-black shadow-md active:bg-yellow-500 flex items-center justify-center gap-1"><RotateCw size={14}/> R-X</button>
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-2">
                                    <button onClick={() => offsetObjectRot('y', 15)} className="bg-yellow-400/80 p-2 rounded-xl border border-yellow-900/30 text-[14px] font-bold text-black shadow-md active:bg-yellow-500 flex items-center justify-center gap-1"><RotateCw size={14}/> R+Y</button>
                                    <button onClick={() => offsetObjectRot('y', -15)} className="bg-yellow-400/80 p-2 rounded-xl border border-yellow-900/30 text-[14px] font-bold text-black shadow-md active:bg-yellow-500 flex items-center justify-center gap-1"><RotateCw size={14}/> R-Y</button>
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                                    <button onClick={() => offsetObjectRot('z', 15)} className="bg-yellow-400/80 p-2 rounded-xl border border-yellow-900/30 text-[14px] font-bold text-black shadow-md active:bg-yellow-500 flex items-center justify-center gap-1"><RotateCw size={14}/> R+Z</button>
                                    <button onClick={() => offsetObjectRot('z', -15)} className="bg-yellow-400/80 p-2 rounded-xl border border-yellow-900/30 text-[14px] font-bold text-black shadow-md active:bg-yellow-500 flex items-center justify-center gap-1"><RotateCw size={14}/> R-Z</button>
                                </div>
                            </div>

                            {/* EXCLUIR Panel */}
                            <div className="bg-[#944] p-3 rounded-sm shadow-inner text-white font-sans border-t border-red-300/20">
                                <h4 className="text-[12px] font-bold mb-2 uppercase">REMOVER_GEOMETRIA</h4>
                                <p className="text-[9px] mb-3 opacity-80 leading-tight">EXCLUIR PRIMITIVA E CARVAR ÁREAS DE CONTATO COM O TERRENO.</p>
                                <button 
                                    onClick={handleDeleteObject}
                                    className="w-full bg-[#f44] hover:bg-[#f66] border border-red-900/30 p-2 rounded flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all text-[12px] font-bold"
                                >
                                    <Trash2 size={16} /> EXCLUIR_CONTATO
                                </button>
                            </div>

                            {/* TEXTURA Panel */}
                            <div className="bg-[#aaa] p-3 rounded-sm shadow-inner text-black font-sans">
                                <h4 className="text-[12px] font-bold mb-2 uppercase">TEXTURA</h4>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => textureInputRef.current?.click()} className="bg-[#eee] border border-black/20 p-2 rounded flex flex-col items-center justify-center hover:bg-white transition-all">
                                        <ImageIcon size={16} />
                                        <span className="text-[8px] mt-1 font-bold">{selectedObject.textureUrl ? 'SUBSTITUIR' : 'ADICIONAR'}</span>
                                    </button>
                                    {selectedObject.textureUrl && (
                                        <button onClick={clearObjectTexture} className="bg-[#eee] border border-black/20 p-2 rounded flex flex-col items-center justify-center hover:bg-white transition-all text-red-700">
                                            <Trash2 size={16} />
                                            <span className="text-[8px] mt-1 font-bold">REMOVER</span>
                                        </button>
                                    )}
                                </div>
                                <input ref={textureInputRef} type="file" accept="image/*" className="hidden" onChange={handleTextureUpload} />
                            </div>

                            {/* DIMENSÕES Panel */}
                            <div className="bg-[#999] p-3 rounded-sm shadow-inner text-black font-sans">
                                <h4 className="text-[12px] font-bold mb-2 uppercase">DIMENSÕES</h4>
                                <div className="grid grid-cols-3 gap-2 mb-3">
                                    <input type="number" value={localScale.x.toFixed(1)} onChange={(e) => setLocalScale({...localScale, x: parseFloat(e.target.value)})} className="bg-[#eee] p-1 border border-black/20 text-[14px] font-bold text-center outline-none" />
                                    <input type="number" value={localScale.y.toFixed(1)} onChange={(e) => setLocalScale({...localScale, y: parseFloat(e.target.value)})} className="bg-[#eee] p-1 border border-black/20 text-[14px] font-bold text-center outline-none" />
                                    <input type="number" value={localScale.z.toFixed(1)} onChange={(e) => setLocalScale({...localScale, z: parseFloat(e.target.value)})} className="bg-[#eee] p-1 border border-black/20 text-[14px] font-bold text-center outline-none" />
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                                    <button onClick={() => offsetObjectScale('x', 1)} className="bg-gray-200 p-2 rounded-xl border border-black/20 text-[14px] font-bold text-black active:bg-white shadow-md">D+X</button>
                                    <button onClick={() => offsetObjectScale('x', -1)} className="bg-gray-200 p-2 rounded-xl border border-black/20 text-[14px] font-bold text-black active:bg-white shadow-md">D-X</button>
                                    <button onClick={() => offsetObjectScale('y', 1)} className="bg-gray-200 p-2 rounded-xl border border-black/20 text-[14px] font-bold text-black active:bg-white shadow-md">D+Y</button>
                                    <button onClick={() => offsetObjectScale('y', -1)} className="bg-gray-200 p-2 rounded-xl border border-black/20 text-[14px] font-bold text-black active:bg-white shadow-md">D-Y</button>
                                    <button onClick={() => offsetObjectScale('z', 1)} className="bg-gray-200 p-2 rounded-xl border border-black/20 text-[14px] font-bold text-black active:bg-white shadow-md">D+Z</button>
                                    <button onClick={() => offsetObjectScale('z', -1)} className="bg-gray-200 p-2 rounded-xl border border-black/20 text-[14px] font-bold text-black active:bg-white shadow-md">D-Z</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        ) : (
            <div className="flex flex-col h-full bg-[#1a1a1a]">
                <div className="p-3 border-b border-[#333] bg-[#1a1a1a]">
                    <button onClick={() => handleSetToolMode('raise')} className="mb-2 flex items-center gap-2 text-[10px] font-bold text-gray-600 hover:text-white transition-colors">
                        <ArrowLeft size={14} /> RETURN_MAIN
                    </button>
                    <h3 className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 text-gray-400`}>
                        {isLayoutMode && 'SCHE_SHAPE'} {isMountainMode && 'SCHE_PEAK'} {isScatterMode && 'SCHE_SCATTER'}
                    </h3>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                     {isLayoutMode && (
                        <div className="space-y-3">
                           <div className="bg-[#222] p-2 rounded border border-[#333]">
                                <div className="flex justify-between text-[10px] mb-1 text-gray-500"><span>HGT_</span><span>{shapeConfig.height}</span></div>
                                <input type="range" min="1" max="80" value={shapeConfig.height} onChange={(e) => updateShapeConfig('height', parseFloat(e.target.value))} className="w-full h-1 bg-[#333] accent-gray-400" />
                           </div>
                        </div>
                     )}

                     {isMountainMode && (
                        <div className="space-y-3">
                            <div className="bg-[#222] p-2 rounded border border-[#333]">
                                <div className="flex justify-between text-[10px] mb-1 text-gray-500"><span>PEAK_H_</span><span>{mountainConfig.height}</span></div>
                                <input type="range" min="10" max="100" value={mountainConfig.height} onChange={(e) => updateMountainConfig('height', parseFloat(e.target.value))} className="w-full h-1 bg-[#333] accent-gray-400" />
                            </div>
                        </div>
                     )}

                     {isScatterMode && (
                        <div className="space-y-3">
                           {scatterGroups.length > 0 && (
                               <div className="mb-4">
                                   <h4 className="text-[10px] font-bold text-gray-600 mb-2 flex items-center gap-1 uppercase">LAYERS_ACTIVE</h4>
                                   <div className="max-h-32 overflow-y-auto space-y-1 bg-[#111] p-1 rounded">
                                       {scatterGroups.map(group => (
                                           <div 
                                                key={group.id}
                                                onClick={() => setSelectedScatterId(group.id)}
                                                className={`text-[10px] p-2 rounded cursor-pointer flex justify-between items-center ${selectedScatterId === group.id ? 'bg-[#333] text-white' : 'bg-[#222] text-[#444] hover:bg-[#2a2a2a]'}`}
                                           >
                                               <span>LAYER_{group.id.substring(0,4)}</span>
                                           </div>
                                       ))}
                                   </div>
                               </div>
                           )}

                           {selectedScatterId ? (
                               <div className="bg-[#222] p-3 rounded border border-[#333] relative">
                                   <button onClick={() => setSelectedScatterId(null)} className="absolute top-2 right-2 text-gray-500 hover:text-white"><X size={12}/></button>
                                   <h4 className="text-[10px] font-bold text-gray-500 mb-3 uppercase">EDIT_LAYER</h4>
                                   <button onClick={deleteSelectedGroup} className="w-full bg-red-900/20 hover:bg-red-900/40 text-red-500 text-[10px] py-1.5 rounded border border-red-900/30">
                                            REMOVE_LAYER
                                   </button>
                               </div>
                           ) : (
                               <>
                                   <div className="bg-[#222] p-3 rounded border border-[#333]">
                                       <label className="text-[10px] font-bold text-gray-500 mb-2 block uppercase">1_OBJECT_SRC</label>
                                       <button onClick={() => modelInputRef.current?.click()} className="w-full bg-[#1a1a1a] text-[#555] text-[10px] py-2 rounded flex items-center justify-center gap-2 border border-[#333] hover:text-[#888]">
                                           <FileBox size={14} /> {scatterConfig.modelUrl ? 'OBJ_READY' : 'SELECT_GLB'}
                                       </button>
                                       <input ref={modelInputRef} type="file" accept=".glb,.gltf" className="hidden" onChange={handleModelUpload} />
                                   </div>
                                   <div className="bg-[#222] p-2 rounded border border-[#333]">
                                        <div className="flex justify-between text-[10px] mb-1 text-gray-500"><span>SEED_</span><span>{scatterConfig.seed}</span></div>
                                        <input type="number" value={scatterConfig.seed} onChange={(e) => updateScatterConfig('seed', parseInt(e.target.value))} className="w-full bg-[#111] border border-[#333] rounded px-1 text-[10px] h-6" />
                                   </div>
                               </>
                           )}
                        </div>
                     )}
                </div>

                <div className="p-3 border-t border-[#333] bg-[#1a1a1a]">
                     <div className="grid grid-cols-2 gap-1 mb-2">
                         <button onClick={() => setShapePoints(prev => prev.slice(0, -1))} className="bg-[#222] text-[#555] text-[10px] py-2 rounded border border-[#333] flex items-center justify-center gap-1 font-bold" disabled={shapePoints.length === 0}><Undo2 size={12} /> UNDO</button>
                         <button onClick={() => setShapePoints([])} className="bg-[#222] text-[#555] text-[10px] py-2 rounded border border-[#333] flex items-center justify-center gap-1 font-bold" disabled={shapePoints.length === 0}><Trash2 size={12} /> CLR</button>
                     </div>
                     <button 
                        onClick={() => {
                            if ((isLayoutMode || isScatterMode) && shapePoints.length < 3) return;
                            if (isMountainMode && shapePoints.length < 2) return;
                            setShouldApplyShape(true);
                        }}
                        disabled={selectedScatterId !== null}
                        className={`w-full py-3 rounded flex items-center justify-center gap-2 font-bold text-[10px] transition-all border ${selectedScatterId ? 'bg-black text-gray-800 border-gray-900' : 'bg-[#333] text-white border-white'}`}
                     >
                        COMMIT_SCHE
                     </button>
                 </div>
            </div>
        )}
      </aside>

      <main className="flex-1 relative bg-black">
        <EditorScene 
          resolution={resolution}
          mapSize={mapSize}
          toolMode={toolMode}
          brush={brush}
          shapeConfig={shapeConfig}
          mountainConfig={mountainConfig}
          scatterConfig={scatterConfig}
          spatialObjects={spatialObjects}
          selectedObjectId={selectedObjectId}
          onSelectObject={setSelectedObjectId}
          waterLevel={waterLevel}
          isViewMode={isViewMode}
          isTestMode={isTestMode}
          onTestModeExit={() => setIsTestMode(false)}
          isSpectatorMode={isSpectatorMode}
          onSpectatorModeExit={() => setIsSpectatorMode(false)}
          terrainData={terrainData}
          shapePoints={shapePoints}
          onShapeAddPoint={(p) => setShapePoints(prev => [...prev, p])}
          shouldApplyShape={shouldApplyShape}
          onShapeApplied={(newGroup) => {
              setShouldApplyShape(false);
              setShapePoints([]); 
              if (newGroup) setScatterGroups(prev => [...prev, newGroup]);
          }}
          view2D={is2DMode} 
          editorRef={editorRef}
          scatterGroups={scatterGroups}
          selectedScatterId={selectedScatterId}
          onSelectScatterGroup={setSelectedObjectId}
        />
        
        {isGenerating && (
            <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center z-50">
                <Loader2 size={32} className="text-[#444] animate-spin mb-4" />
                <h2 className="text-[10px] font-bold text-[#444] uppercase tracking-[0.2em]">GENERATING_MESH</h2>
            </div>
        )}
      </main>
    </div>
  );
};

export default App;