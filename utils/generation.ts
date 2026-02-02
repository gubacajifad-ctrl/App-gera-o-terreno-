import * as THREE from 'three';

// ---- CONFIGURATION ----
export const CHUNK_SIZE = 128; 

// Global Data Storage Helpers
export const getGlobalIndex = (gx: number, gy: number, totalRes: number) => gy * totalRes + gx;

// ---- SEEDED RNG (Linear Congruential Generator) ----
export class SeededRandom {
    private seed: number;
    constructor(seed: number) {
        this.seed = seed;
    }
    
    next(): number {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }

    range(min: number, max: number): number {
        return min + this.next() * (max - min);
    }
}

const random = () => Math.random();

function grad(hash: number, x: number, y: number) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

const p = new Uint8Array(512);
for (let i = 0; i < 256; i++) p[i] = i;
for (let i = 0; i < 256; i++) {
  const r = Math.floor(random() * 256);
  [p[i], p[r]] = [p[r], p[i]];
  p[i + 256] = p[i];
}

function noise2D(x: number, y: number) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const aa = p[p[X] + Y];
  const ab = p[p[X] + Y + 1];
  const ba = p[p[X + 1] + Y];
  const bb = p[p[X + 1] + Y + 1];
  return lerp(v, lerp(u, grad(aa, xf, yf), grad(ba, xf - 1, yf)), lerp(u, grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1)));
}

function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(t: number, a: number, b: number) { return a + t * (b - a); }

export const getTerrainHeightAtWorldPos = (
    worldX: number, 
    worldZ: number, 
    heightData: Float32Array, 
    resolution: number, 
    worldSize: number
): number => {
    const mapHalf = worldSize / 2;
    const gridX = ((worldX + mapHalf) / worldSize) * resolution;
    const gridY = ((worldZ + mapHalf) / worldSize) * resolution;

    if (gridX < 0 || gridX >= resolution - 1 || gridY < 0 || gridY >= resolution - 1) {
        return -100; 
    }

    const x0 = Math.floor(gridX);
    const y0 = Math.floor(gridY);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    
    const xFrac = gridX - x0;
    const yFrac = gridY - y0;

    const h00 = heightData[y0 * resolution + x0];
    const h10 = heightData[y0 * resolution + x1];
    const h01 = heightData[y1 * resolution + x0];
    const h11 = heightData[y1 * resolution + x1];

    const h0 = lerp(xFrac, h00, h10);
    const h1 = lerp(xFrac, h01, h11);
    
    return lerp(yFrac, h0, h1);
};


// ---- ABANDONED / LIMINAL PALETTE ----

const COLORS = {
    waterDeep: new THREE.Color('#4a5054'),    // Murky Grey-Green
    waterShallow: new THREE.Color('#6c7578'), // Lighter Silty Grey
    sand: new THREE.Color('#948e83'),         // Dry Dust / Pale Dirt
    grassLow: new THREE.Color('#7d8072'),     // Dead Grass / Dry Weeds
    grassHigh: new THREE.Color('#63695b'),    // Overgrown Mossy Grey
    rock: new THREE.Color('#8c8c8c'),         // Weathered Concrete
    snow: new THREE.Color('#e0e0e0')          // Overcast Sky Reflection
};

const calculateProceduralColor = (
    x: number, 
    y: number, 
    height: number, 
    globalHeight: Float32Array, 
    resolution: number
): { r: number, g: number, b: number } => {
    
    const idx = y * resolution + x;
    const hL = x > 0 ? globalHeight[idx - 1] : height;
    const hR = x < resolution - 1 ? globalHeight[idx + 1] : height;
    const hU = y > 0 ? globalHeight[idx - resolution] : height;
    const hD = y < resolution - 1 ? globalHeight[idx + resolution] : height;

    const slopeX = Math.abs(hR - hL);
    const slopeY = Math.abs(hD - hU);
    const slope = Math.sqrt(slopeX * slopeX + slopeY * slopeY);

    const noiseLarge = noise2D(x * 0.05, y * 0.05); 
    
    let finalColor = new THREE.Color();
    const h = height + (noiseLarge * 2.0); 
    const slopeThreshold = 1.2; 

    if (h < 1.0) {
        finalColor.copy(COLORS.sand);
        if (h < 0.5) finalColor.lerp(COLORS.waterDeep, 0.3);
    } else if (slope > slopeThreshold) {
        finalColor.copy(COLORS.rock);
        // Concrete weathering/stains
        if (noise2D(x*0.15, y*0.15) > 0.4) finalColor.multiplyScalar(0.85); // Darker stain
    } else if (h < 10.0) {
        finalColor.copy(COLORS.grassLow);
        // Patchy dry ground
        if (noise2D(x*0.08, y*0.08) > 0.2) finalColor.copy(COLORS.sand); 
    } else if (h < 35.0) {
        finalColor.copy(COLORS.rock); // Retaining walls / structures
        // Moss growing on concrete
        if (noise2D(x*0.1, y*0.1) > 0.3) finalColor.lerp(COLORS.grassHigh, 0.5);
    } else {
        finalColor.copy(COLORS.rock); 
        if (h > 50) finalColor.lerp(COLORS.snow, 0.5); // High altitude fade
    }

    return { r: finalColor.r, g: finalColor.g, b: finalColor.b };
};

export const createNoiseTexture = (): THREE.CanvasTexture => {
    const size = 128; 
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    if(ctx) {
        // 1. Base: Light Concrete / Overcast Light
        ctx.fillStyle = '#999999';
        ctx.fillRect(0,0,size,size);

        // 2. Weathering Noise (Lighter and Darker)
        const imgData = ctx.getImageData(0,0,size,size);
        const data = imgData.data;
        for(let i = 0; i < data.length; i += 4) {
            const val = Math.random();
            let grain = 1.0;
            
            // Rust/Dirt specks (Darker)
            if (val < 0.2) grain = 0.85;
            // Highlights/Salt (Lighter)
            else if (val > 0.8) grain = 1.1;
            
            data[i] = Math.min(255, data[i] * grain);
            data[i+1] = Math.min(255, data[i+1] * grain);
            data[i+2] = Math.min(255, data[i+2] * grain);
            data[i+3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);

        // 3. Faint Grid (Man-made structure underneath)
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for(let j=0; j<size; j+=32) {
          ctx.moveTo(0, j); ctx.lineTo(size, j);
          ctx.moveTo(j, 0); ctx.lineTo(j, size);
        }
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 8); 
    return texture;
}

export const initMasterData = (totalResolution: number) => {
  const size = totalResolution;
  const heightData = new Float32Array(size * size);
  const colorData = new Float32Array(size * size * 3);
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      heightData[idx] = 0; 
      const col = calculateProceduralColor(x, y, 0, heightData, size);
      colorData[idx * 3] = col.r;
      colorData[idx * 3 + 1] = col.g;
      colorData[idx * 3 + 2] = col.b;
    }
  }

  return { heightData, colorData };
};

export const applyBrushOptimized = (
  globalHeight: Float32Array,
  globalColor: Float32Array,
  totalResolution: number,
  worldSize: number, 
  worldPoint: THREE.Vector3,
  brushRadius: number,
  strength: number,
  mode: 'sculpt' | 'level' | 'paint',
  targetHeight: number,
  colorHex: string
): Set<string> => {
    
  const dirtyChunks = new Set<string>();
  const mapHalf = worldSize / 2;
  const chunksPerSide = worldSize / CHUNK_SIZE;
  
  const gridX = Math.floor(((worldPoint.x + mapHalf) / worldSize) * totalResolution);
  const gridY = Math.floor(((worldPoint.z + mapHalf) / worldSize) * totalResolution);
  
  const radiusGrid = Math.ceil((brushRadius / worldSize) * totalResolution);
  const r2 = radiusGrid * radiusGrid;

  const startX = Math.max(0, gridX - radiusGrid);
  const endX = Math.min(totalResolution - 1, gridX + radiusGrid);
  const startY = Math.max(0, gridY - radiusGrid);
  const endY = Math.min(totalResolution - 1, gridY + radiusGrid);

  const paintColor = new THREE.Color(colorHex);

  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const dx = x - gridX;
      const dy = y - gridY;
      const distSq = dx*dx + dy*dy;

      if (distSq < r2) {
        const falloff = Math.pow(1 - distSq / r2, 2);
        const idx = y * totalResolution + x;
        let modified = false;

        if (mode === 'sculpt') {
            globalHeight[idx] += strength * falloff;
            modified = true;
        } else if (mode === 'level') {
            globalHeight[idx] = lerp(strength * 0.1 * falloff, globalHeight[idx], targetHeight);
            modified = true;
        } else if (mode === 'paint') {
             const mix = strength * falloff * 5; 
             const clampedMix = Math.min(1, Math.max(0, mix));
             globalColor[idx * 3] = lerp(clampedMix, globalColor[idx * 3], paintColor.r);
             globalColor[idx * 3 + 1] = lerp(clampedMix, globalColor[idx * 3 + 1], paintColor.g);
             globalColor[idx * 3 + 2] = lerp(clampedMix, globalColor[idx * 3 + 2], paintColor.b);
             modified = true;
        }

        if (modified) {
            if (mode === 'sculpt' || mode === 'level') {
                 const col = calculateProceduralColor(x, y, globalHeight[idx], globalHeight, totalResolution);
                 globalColor[idx * 3] = col.r;
                 globalColor[idx * 3 + 1] = col.g;
                 globalColor[idx * 3 + 2] = col.b;
            }

            const verticesPerChunk = totalResolution / chunksPerSide;
            const cx = Math.floor(x / verticesPerChunk);
            const cy = Math.floor(y / verticesPerChunk);
            dirtyChunks.add(`${cx},${cy}`);
            
            if (x % verticesPerChunk === 0 && cx > 0) dirtyChunks.add(`${cx-1},${cy}`);
            if (y % verticesPerChunk === 0 && cy > 0) dirtyChunks.add(`${cx},${cy-1}`);
        }
      }
    }
  }
  
  return dirtyChunks;
}

export const distToSegmentSq = (p: {x:number, y:number}, v: {x:number, y:number}, w: {x:number, y:number}) => {
    const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
    if (l2 === 0) return (p.x - v.x)**2 + (p.y - v.y)**2;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (p.x - (v.x + t * (w.x - v.x)))**2 + (p.y - (v.y + t * (w.y - v.y)))**2;
};

export const isPointInPoly = (x: number, y: number, poly: {x:number, y:number}[]) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

export const applyShapeToHeightmap = (
  globalHeight: Float32Array,
  globalColor: Float32Array,
  totalResolution: number,
  worldSize: number,
  shapePoints: THREE.Vector3[],
  config: { height: number, falloff: number, noiseStrength: number }
): Set<string> => {
    const dirtyChunks = new Set<string>();
    if (shapePoints.length < 3) return dirtyChunks; 

    const mapHalf = worldSize / 2;
    const chunksPerSide = worldSize / CHUNK_SIZE;
    const verticesPerChunk = totalResolution / chunksPerSide;

    const gridPoints = shapePoints.map(p => ({
        x: ((p.x + mapHalf) / worldSize) * totalResolution,
        y: ((p.z + mapHalf) / worldSize) * totalResolution
    }));

    let minX = totalResolution, maxX = 0, minY = totalResolution, maxY = 0;
    const falloffGrid = (config.falloff / worldSize) * totalResolution;

    gridPoints.forEach(p => {
        const fGrid = falloffGrid;
        minX = Math.min(minX, Math.floor(p.x - fGrid)); 
        maxX = Math.max(maxX, Math.ceil(p.x + fGrid));
        minY = Math.min(minY, Math.floor(p.y - fGrid));
        maxY = Math.max(maxY, Math.ceil(p.y + fGrid));
    });

    minX = Math.max(0, minX); maxX = Math.min(totalResolution - 1, maxX);
    minY = Math.max(0, minY); maxY = Math.min(totalResolution - 1, maxY);

    const seed = Math.random() * 1000;

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const idx = y * totalResolution + x;
            
            let distSq = Infinity;
            for (let i = 0; i < gridPoints.length; i++) {
                const v = gridPoints[i];
                const w = gridPoints[(i + 1) % gridPoints.length];
                distSq = Math.min(distSq, distToSegmentSq({x, y}, v, w));
            }
            const dist = Math.sqrt(distSq);
            
            const worldX = (x / totalResolution) * worldSize;
            const worldY = (y / totalResolution) * worldSize;
            
            const n1 = noise2D(worldX * 0.1 + seed, worldY * 0.1 + seed);
            const boundaryNoise = n1 * config.noiseStrength * (falloffGrid * 0.25);
            const naturalDist = dist + boundaryNoise;
            const inside = isPointInPoly(x, y, gridPoints);

            if (inside) {
                let factor = 1.0;
                
                if (falloffGrid > 0) {
                   factor = Math.min(1.0, Math.max(0, naturalDist / falloffGrid));
                   factor = factor * factor * (3 - 2 * factor);
                }

                const newHeight = config.height * factor;

                if (newHeight > globalHeight[idx]) {
                     globalHeight[idx] = newHeight;
                     const col = calculateProceduralColor(x, y, newHeight, globalHeight, totalResolution);
                     globalColor[idx * 3] = col.r;
                     globalColor[idx * 3 + 1] = col.g;
                     globalColor[idx * 3 + 2] = col.b;

                     const cx = Math.floor(x / verticesPerChunk);
                     const cy = Math.floor(y / verticesPerChunk);
                     dirtyChunks.add(`${cx},${cy}`);
                     if (x % verticesPerChunk === 0 && cx > 0) dirtyChunks.add(`${cx-1},${cy}`);
                     if (y % verticesPerChunk === 0 && cy > 0) dirtyChunks.add(`${cx},${cy-1}`);
                }
            }
        }
    }

    return dirtyChunks;
}

export const applyMountainToHeightmap = (
  globalHeight: Float32Array,
  globalColor: Float32Array,
  totalResolution: number,
  worldSize: number,
  linePoints: THREE.Vector3[],
  config: { height: number, width: number, ridgeNoise: number, flankNoise: number }
): Set<string> => {
    const dirtyChunks = new Set<string>();
    if (linePoints.length < 2) return dirtyChunks;

    const mapHalf = worldSize / 2;
    const chunksPerSide = worldSize / CHUNK_SIZE;
    const verticesPerChunk = totalResolution / chunksPerSide;

    const gridPoints = linePoints.map(p => ({
        x: ((p.x + mapHalf) / worldSize) * totalResolution,
        y: ((p.z + mapHalf) / worldSize) * totalResolution
    }));

    const maxWidthGrid = (config.width / worldSize) * totalResolution;

    let minX = totalResolution, maxX = 0, minY = totalResolution, maxY = 0;
    gridPoints.forEach(p => {
        minX = Math.min(minX, Math.floor(p.x - maxWidthGrid)); 
        maxX = Math.max(maxX, Math.ceil(p.x + maxWidthGrid));
        minY = Math.min(minY, Math.floor(p.y - maxWidthGrid));
        maxY = Math.max(maxY, Math.ceil(p.y + maxWidthGrid));
    });
    minX = Math.max(0, minX); maxX = Math.min(totalResolution - 1, maxX);
    minY = Math.max(0, minY); maxY = Math.min(totalResolution - 1, maxY);

    const seed = Math.random() * 1000;

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const idx = y * totalResolution + x;

            let minDistSq = Infinity;
            for (let i = 0; i < gridPoints.length - 1; i++) {
                const v = gridPoints[i];
                const w = gridPoints[i+1];
                const dSq = distToSegmentSq({x, y}, v, w);
                if (dSq < minDistSq) {
                    minDistSq = dSq;
                }
            }
            
            const dist = Math.sqrt(minDistSq);

            if (dist < maxWidthGrid) {
                const t = dist / maxWidthGrid;
                const profile = Math.pow(1 - t, 2.0); 

                const worldX = (x / totalResolution) * worldSize;
                const worldY = (y / totalResolution) * worldSize;
                
                const ridgeVar = noise2D(worldX * 0.05 + seed, worldY * 0.05 + seed); 
                const ridgeFactor = 1.0 + (ridgeVar * config.ridgeNoise);

                let mountainHeight = (config.height * profile * ridgeFactor);
                if (mountainHeight < 0) mountainHeight = 0;

                if (mountainHeight > globalHeight[idx]) {
                    globalHeight[idx] = Math.max(globalHeight[idx], mountainHeight);
                    
                    const col = calculateProceduralColor(x, y, globalHeight[idx], globalHeight, totalResolution);
                    globalColor[idx * 3] = col.r;
                    globalColor[idx * 3 + 1] = col.g;
                    globalColor[idx * 3 + 2] = col.b;
                    
                    const cx = Math.floor(x / verticesPerChunk);
                    const cy = Math.floor(y / verticesPerChunk);
                    dirtyChunks.add(`${cx},${cy}`);
                    if (x % verticesPerChunk === 0 && cx > 0) dirtyChunks.add(`${cx-1},${cy}`);
                    if (y % verticesPerChunk === 0 && cy > 0) dirtyChunks.add(`${cx},${cy-1}`);
                }
            }
        }
    }

    return dirtyChunks;
}

export const generateScatterPoints = (
    polyPoints: THREE.Vector3[],
    count: number,
    globalHeight: Float32Array,
    totalResolution: number,
    worldSize: number,
    seed: number 
) => {
    const results: { position: THREE.Vector3, rotation: THREE.Euler, scale: number }[] = [];
    if (polyPoints.length < 3) return results;

    const mapHalf = worldSize / 2;
    const rng = new SeededRandom(seed);
    
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    polyPoints.forEach(p => {
        if(p.x < minX) minX = p.x;
        if(p.x > maxX) maxX = p.x;
        if(p.z < minZ) minZ = p.z;
        if(p.z > maxZ) maxZ = p.z;
    });

    const checkPoly = polyPoints.map(p => ({ x: p.x, y: p.z }));

    let attempts = 0;
    while(results.length < count && attempts < count * 5) {
        attempts++;
        const rx = rng.range(minX, maxX);
        const rz = rng.range(minZ, maxZ);

        if (isPointInPoly(rx, rz, checkPoly)) {
            const gridX = Math.floor(((rx + mapHalf) / worldSize) * totalResolution);
            const gridY = Math.floor(((rz + mapHalf) / worldSize) * totalResolution);

            if (gridX >= 0 && gridX < totalResolution && gridY >= 0 && gridY < totalResolution) {
                const h = globalHeight[gridY * totalResolution + gridX];
                
                const rotY = rng.next() * Math.PI * 2;
                
                results.push({
                    position: new THREE.Vector3(rx, h, rz),
                    rotation: new THREE.Euler(0, rotY, 0),
                    scale: 1.0 
                });
            }
        }
    }
    return results;
}

export const generateTerrainFromImage = async (
  imageFile: File, 
  resolution: number, 
  worldHeightScale: number = 30
): Promise<{ heightData: Float32Array; colorData: Float32Array }> => {
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = resolution;
      canvas.height = resolution;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return reject("No Canvas Context");
      }

      ctx.drawImage(img, 0, 0, resolution, resolution);
      const imgData = ctx.getImageData(0, 0, resolution, resolution);
      const pixels = imgData.data;

      const heightData = new Float32Array(resolution * resolution);
      const colorData = new Float32Array(resolution * resolution * 3);

      for (let i = 0; i < resolution * resolution; i++) {
        const r = pixels[i * 4];
        const g = pixels[i * 4 + 1];
        const b = pixels[i * 4 + 2];
        const avg = (r + g + b) / 3 / 255;
        heightData[i] = avg * worldHeightScale;
      }

      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const idx = y * resolution + x;
          const col = calculateProceduralColor(x, y, heightData[idx], heightData, resolution);
          colorData[idx * 3] = col.r;
          colorData[idx * 3 + 1] = col.g;
          colorData[idx * 3 + 2] = col.b;
        }
      }

      URL.revokeObjectURL(url);
      resolve({ heightData, colorData });
    };

    img.onerror = () => {
        URL.revokeObjectURL(url);
        reject("Failed to load image");
    }

    img.src = url;
  });
};

export const downloadCanvasAsImage = (canvas: HTMLCanvasElement, filename: string) => {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

export const exportHeightmapToImage = (heightData: Float32Array, resolution: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;
    const ctx = canvas.getContext('2d');
    if(!ctx) return;

    const imgData = ctx.createImageData(resolution, resolution);
    const data = imgData.data;

    let max = 0;
    for(let i=0; i<heightData.length; i++) if(heightData[i] > max) max = heightData[i];
    if (max === 0) max = 1;

    for(let i=0; i<resolution*resolution; i++) {
        const val = Math.floor((heightData[i] / max) * 255);
        data[i*4] = val;
        data[i*4+1] = val;
        data[i*4+2] = val;
        data[i*4+3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    downloadCanvasAsImage(canvas, 'terrain_heightmap.png');
}

export const exportColorMapToImage = (colorData: Float32Array, resolution: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;
    const ctx = canvas.getContext('2d');
    if(!ctx) return;

    const imgData = ctx.createImageData(resolution, resolution);
    const data = imgData.data;

    for(let i=0; i<resolution*resolution; i++) {
        data[i*4] = Math.floor(colorData[i*3] * 255);
        data[i*4+1] = Math.floor(colorData[i*3+1] * 255);
        data[i*4+2] = Math.floor(colorData[i*3+2] * 255);
        data[i*4+3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    downloadCanvasAsImage(canvas, 'terrain_texture.png');
}

/**
 * Carves the terrain using the geometry of a primitive.
 * Effectively 'deleting the part in contact' by subtracting height.
 */
export const applySubtractionToHeightmap = (
    globalHeight: Float32Array,
    globalColor: Float32Array,
    totalResolution: number,
    worldSize: number,
    position: [number, number, number],
    scale: [number, number, number],
    type: 'cube' | 'sphere' | 'cylinder'
): Set<string> => {
    const dirtyChunks = new Set<string>();
    const mapHalf = worldSize / 2;
    const chunksPerSide = worldSize / CHUNK_SIZE;
    const verticesPerChunk = totalResolution / chunksPerSide;

    // Convert world position and scale to grid coordinates
    const gridX = ((position[0] + mapHalf) / worldSize) * totalResolution;
    const gridZ = ((position[2] + mapHalf) / worldSize) * totalResolution;
    const gridScaleX = (scale[0] / worldSize) * totalResolution;
    const gridScaleZ = (scale[2] / worldSize) * totalResolution;

    const startX = Math.max(0, Math.floor(gridX - gridScaleX / 2));
    const endX = Math.min(totalResolution - 1, Math.ceil(gridX + gridScaleX / 2));
    const startY = Math.max(0, Math.floor(gridZ - gridScaleZ / 2));
    const endY = Math.min(totalResolution - 1, Math.ceil(gridZ + gridScaleZ / 2));

    for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
            const idx = y * totalResolution + x;
            
            let inside = false;
            const dx = (x - gridX) / (gridScaleX / 2);
            const dz = (y - gridZ) / (gridScaleZ / 2);

            if (type === 'cube') {
                inside = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
            } else if (type === 'sphere' || type === 'cylinder') {
                inside = dx * dx + dz * dz <= 1;
            }

            if (inside) {
                // Subtract the object's height from the terrain at this point
                const objectFloor = position[1] - scale[1] / 2;
                const objectCeil = position[1] + scale[1] / 2;

                // If the object overlaps the terrain height, carve it down to the object's floor
                if (globalHeight[idx] > objectFloor) {
                    globalHeight[idx] = Math.max(-50, objectFloor);
                    
                    // Update procedural color
                    const col = calculateProceduralColor(x, y, globalHeight[idx], globalHeight, totalResolution);
                    globalColor[idx * 3] = col.r;
                    globalColor[idx * 3 + 1] = col.g;
                    globalColor[idx * 3 + 2] = col.b;

                    const cx = Math.floor(x / verticesPerChunk);
                    const cy = Math.floor(y / verticesPerChunk);
                    dirtyChunks.add(`${cx},${cy}`);
                    if (x % verticesPerChunk === 0 && cx > 0) dirtyChunks.add(`${cx-1},${cy}`);
                    if (y % verticesPerChunk === 0 && cy > 0) dirtyChunks.add(`${cx},${cy-1}`);
                }
            }
        }
    }
    return dirtyChunks;
}