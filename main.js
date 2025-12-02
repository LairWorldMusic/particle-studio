import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

let scene, camera, renderer, particles, composer, bloomPass;
let video, videoCanvas, videoCtx;
let positions, colors;
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

const trailHistory = [];
const TRAIL_LENGTH = 6;

let stream = null;
let isRunning = false;
let isCameraOn = true;
let isDarkTheme = true;
let isProcessing = false;

// Эффекты
let particlesEnabled = true;
let surveillanceEnabled = false;
let audioReactiveEnabled = false;
let bloomEnabled = true;

// Audio Reactive (системный звук)
let audioContext, analyser, audioData;
let audioParticles, audioPositions, audioColors, audioSizes;
const AUDIO_RINGS = 12;
const PARTICLES_PER_RING = 400;

// Для surveillance эффекта
let surveillanceCanvas, surveillanceCtx;
let trackedObjects = [];
let objectIdCounter = 1;
let prevFrameData = null;
const MAX_TRACKED_OBJECTS = 5;

// Для отображения камеры без эффектов
let rawVideoCanvas, rawVideoCtx;
let selectedDeviceId = null;
let availableCameras = [];
let selectedQuality = 720;

// Audio visualizer canvas
let audioCanvas, audioCtx;

// App settings
let appSettings = null;

// UI toggle

init();

// Listen for auth from deep link
window.electronAPI?.onAuthSuccess?.((userData) => {
  console.log('Auth success from deep link:', userData);
  localStorage.setItem('user', JSON.stringify(userData));
  updateUserUI(userData);
  hideWelcomeScreen();
  loadCameras();
  startCamera();
});



async function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030712); // Начальный цвет фона
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 500;

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);

  const maxPoints = 150000;
  const geometry = new THREE.BufferGeometry();
  positions = new Float32Array(maxPoints * 3);
  colors = new Float32Array(maxPoints * 3);

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 2,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending
  });

  particles = new THREE.Points(geometry, material);
  scene.add(particles);

  // Настраиваем постобработку с bloom эффектом
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.5,   // strength
    0.4,   // radius
    0.85   // threshold
  );
  composer.addPass(bloomPass);

  // Инициализируем аудио частицы
  createAudioRings();

  videoCanvas = document.createElement('canvas');
  videoCanvas.width = VIDEO_WIDTH;
  videoCanvas.height = VIDEO_HEIGHT;
  videoCtx = videoCanvas.getContext('2d', { willReadFrequently: true });

  // Canvas для surveillance оверлея
  surveillanceCanvas = document.createElement('canvas');
  surveillanceCanvas.id = 'surveillanceCanvas';
  surveillanceCanvas.width = window.innerWidth;
  surveillanceCanvas.height = window.innerHeight;
  surveillanceCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;display:none;z-index:10;';
  document.body.appendChild(surveillanceCanvas);
  surveillanceCtx = surveillanceCanvas.getContext('2d');

  // Canvas для показа обычной камеры
  rawVideoCanvas = document.createElement('canvas');
  rawVideoCanvas.id = 'rawVideoCanvas';
  rawVideoCanvas.width = window.innerWidth;
  rawVideoCanvas.height = window.innerHeight;
  rawVideoCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:none;z-index:1;';
  document.body.appendChild(rawVideoCanvas);
  rawVideoCtx = rawVideoCanvas.getContext('2d');

  // Canvas для audio visualizer
  audioCanvas = document.createElement('canvas');
  audioCanvas.id = 'audioCanvas';
  audioCanvas.width = window.innerWidth;
  audioCanvas.height = window.innerHeight;
  audioCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;display:none;z-index:12;';
  document.body.appendChild(audioCanvas);
  audioCtx = audioCanvas.getContext('2d');

  // Кнопки окна (Electron)
  document.getElementById('minBtn')?.addEventListener('click', () => window.electronAPI?.minimize());
  document.getElementById('maxBtn')?.addEventListener('click', () => window.electronAPI?.maximize());
  document.getElementById('closeBtn')?.addEventListener('click', () => window.electronAPI?.close());
  
  // Кнопки на welcome screen
  document.getElementById('welcomeMinBtn')?.addEventListener('click', () => window.electronAPI?.minimize());
  document.getElementById('welcomeMaxBtn')?.addEventListener('click', () => window.electronAPI?.maximize());
  document.getElementById('welcomeCloseBtn')?.addEventListener('click', () => window.electronAPI?.close());
  document.getElementById('themeBtn')?.addEventListener('click', toggleTheme);
  document.getElementById('particlesBtn')?.addEventListener('click', toggleParticles);
  document.getElementById('surveillanceBtn')?.addEventListener('click', toggleSurveillance);
  document.getElementById('settingsBtn')?.addEventListener('click', toggleSettings);
  
  const audioBtn = document.getElementById('audioBtn');
  console.log('audioBtn element:', audioBtn);
  if (audioBtn) {
    audioBtn.addEventListener('click', () => {
      console.log('Audio button clicked!');
      toggleAudioReactive();
    });
  }
  
  document.getElementById('cameraToggleBtn')?.addEventListener('click', toggleCamera);
  document.getElementById('bloomBtn')?.addEventListener('click', toggleBloom);
  document.getElementById('profileBtn')?.addEventListener('click', toggleProfile);
  
  // Control panel buttons
  document.getElementById('ctrl-particles')?.addEventListener('click', () => { toggleParticles(); toggleControlBtn('ctrl-particles'); });
  document.getElementById('ctrl-tracking')?.addEventListener('click', () => { toggleSurveillance(); toggleControlBtn('ctrl-tracking'); });
  document.getElementById('ctrl-audio')?.addEventListener('click', () => { toggleAudioReactive(); toggleControlBtn('ctrl-audio'); });
  document.getElementById('ctrl-bloom')?.addEventListener('click', () => { toggleBloom(); toggleControlBtn('ctrl-bloom'); });
  document.getElementById('ctrl-camera')?.addEventListener('click', () => { toggleCamera(); toggleControlBtn('ctrl-camera'); });
  document.getElementById('ctrl-theme')?.addEventListener('click', () => { toggleTheme(); updateThemeIcon(); });
  document.getElementById('ctrl-settings')?.addEventListener('click', toggleSettings);
  
  // Welcome screen & Firebase auth
  initWelcomeScreen();
  
  // Firebase will handle auth state via onAuthStateChanged in initWelcomeScreen
  
  window.addEventListener('resize', onResize);
  animate();
}

async function loadCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    availableCameras = devices.filter(d => d.kind === 'videoinput');
    updateCameraSelect();
  } catch (err) {
    console.error('Не удалось получить список камер:', err);
  }
}

function updateCameraSelect() {
  const select = document.getElementById('cameraSelect');
  if (!select) return;
  
  select.innerHTML = '';
  availableCameras.forEach((cam, i) => {
    const option = document.createElement('option');
    option.value = cam.deviceId;
    option.textContent = cam.label || `Камера ${i + 1}`;
    if (cam.deviceId === selectedDeviceId) option.selected = true;
    select.appendChild(option);
  });
  
  select.onchange = () => {
    selectedDeviceId = select.value;
    restartCamera();
  };
}

async function startCamera() {
  if (isRunning || !isCameraOn) return;
  
  const info = document.getElementById('info');
  if (info) info.textContent = 'Запуск камеры...';
  
  // Calculate dimensions based on quality
  const qualityMap = { 1080: { w: 1920, h: 1080 }, 720: { w: 1280, h: 720 }, 480: { w: 640, h: 480 } };
  const quality = qualityMap[selectedQuality] || qualityMap[720];
  
  try {
    const constraints = {
      video: {
        width: { ideal: quality.w },
        height: { ideal: quality.h },
        ...(selectedDeviceId && { deviceId: { exact: selectedDeviceId } })
      }
    };
    
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    await loadCameras();
    
    const track = stream.getVideoTracks()[0];
    if (track) {
      selectedDeviceId = track.getSettings().deviceId;
      updateCameraSelect();
    }
    
    video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    
    isRunning = true;
    if (info) info.style.display = 'none';
    
    setInterval(processFrame, 1000 / 24);
  } catch (err) {
    if (info) {
      info.style.display = 'block';
      info.textContent = 'Ошибка: ' + err.message;
    }
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  if (video) {
    video.srcObject = null;
    video = null;
  }
  isRunning = false;
  
  // Очищаем частицы
  trailHistory.length = 0;
  particles.geometry.setDrawRange(0, 0);
}

async function restartCamera() {
  stopCamera();
  if (isCameraOn) {
    await startCamera();
  }
}

function toggleCamera() {
  isCameraOn = !isCameraOn;
  
  const btn = document.getElementById('cameraToggleBtn');
  if (btn) {
    btn.textContent = isCameraOn ? '📷' : '🚫';
    btn.style.opacity = isCameraOn ? '1' : '0.5';
  }
  
  if (isCameraOn) {
    startCamera();
  } else {
    stopCamera();
  }
}

function toggleBloom() {
  bloomEnabled = !bloomEnabled;
  
  const btn = document.getElementById('bloomBtn');
  if (btn) {
    btn.style.opacity = bloomEnabled ? '1' : '0.5';
  }
  
  bloomPass.strength = bloomEnabled ? 1.5 : 0;
}

// Плавная смена темы
let themeTransition = { progress: 0, active: false, fromColor: null, toColor: null };

function toggleTheme() {
  isDarkTheme = !isDarkTheme;
  
  // Запускаем плавный переход для Three.js сцены
  themeTransition.fromColor = scene.background.clone();
  themeTransition.toColor = new THREE.Color(isDarkTheme ? 0x030712 : 0xf8fafc);
  themeTransition.progress = 0;
  themeTransition.active = true;
  
  // CSS переходы для body
  if (isDarkTheme) {
    particles.material.blending = THREE.AdditiveBlending;
    document.body.classList.remove('light-theme');
  } else {
    particles.material.blending = THREE.SubtractiveBlending;
    document.body.classList.add('light-theme');
  }
  
  const themeBtn = document.getElementById('ctrl-theme');
  if (themeBtn) themeBtn.textContent = isDarkTheme ? '☀' : '🌙';
}

function updateThemeTransition() {
  if (!themeTransition.active) return;
  
  themeTransition.progress += 0.03; // ~400ms при 60fps
  
  if (themeTransition.progress >= 1) {
    themeTransition.progress = 1;
    themeTransition.active = false;
  }
  
  // Плавная интерполяция цвета (easeInOutCubic)
  const t = themeTransition.progress;
  const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  
  scene.background.lerpColors(themeTransition.fromColor, themeTransition.toColor, ease);
}

function toggleParticles() {
  particlesEnabled = !particlesEnabled;
  
  const btn = document.getElementById('particlesBtn');
  if (btn) {
    btn.textContent = particlesEnabled ? '✨' : '⭐';
    btn.style.opacity = particlesEnabled ? '1' : '0.5';
  }
  
  renderer.domElement.style.display = particlesEnabled ? 'block' : 'none';
  rawVideoCanvas.style.display = particlesEnabled ? 'none' : 'block';
}

function toggleSettings() {
  const panel = document.getElementById('settingsPanel');
  if (panel) {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }
}

function toggleSurveillance() {
  surveillanceEnabled = !surveillanceEnabled;
  
  const btn = document.getElementById('surveillanceBtn');
  if (btn) {
    btn.style.opacity = surveillanceEnabled ? '1' : '0.5';
  }
  
  surveillanceCanvas.style.display = surveillanceEnabled ? 'block' : 'none';
  
  if (surveillanceEnabled) {
    trackedObjects = [];
    objectIdCounter = 1;
  }
}

function toggleAudioReactive() {
  console.log('Audio button clicked');
  audioReactiveEnabled = !audioReactiveEnabled;
  const btn = document.getElementById('audioBtn');
  if (btn) btn.style.opacity = audioReactiveEnabled ? '1' : '0.5';
  
  // Показываем/скрываем частицы
  if (audioParticles) {
    audioParticles.visible = audioReactiveEnabled;
  }
  
  if (audioReactiveEnabled && !audioContext) {
    initAudio();
  }
}

function processFrame() {
  if (!isRunning || !video || video.readyState < 2 || isProcessing) return;
  isProcessing = true;

  // Рисуем камеру (без зеркалирования)
  videoCtx.drawImage(video, 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);

  const imageData = videoCtx.getImageData(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  const pixels = imageData.data;

  if (surveillanceEnabled) {
    surveillanceCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    processSurveillanceFrame(imageData);
    surveillanceCanvas.style.display = 'block';
  } else {
    surveillanceCanvas.style.display = 'none';
  }
  
  prevFrameData = new Uint8ClampedArray(pixels);
  
  if (!particlesEnabled) {
    drawRawVideo();
    isProcessing = false;
    return;
  }

  const framePoints = [];

  for (let y = 2; y < VIDEO_HEIGHT - 2; y += 2) {
    for (let x = 2; x < VIDEO_WIDTH - 2; x += 2) {
      const i = (y * VIDEO_WIDTH + x) * 4;
      
      const left = (y * VIDEO_WIDTH + (x - 2)) * 4;
      const right = (y * VIDEO_WIDTH + (x + 2)) * 4;
      const top = ((y - 2) * VIDEO_WIDTH + x) * 4;
      const bottom = ((y + 2) * VIDEO_WIDTH + x) * 4;
      
      const gx = Math.abs(
        (pixels[right] + pixels[right + 1] + pixels[right + 2]) -
        (pixels[left] + pixels[left + 1] + pixels[left + 2])
      );
      const gy = Math.abs(
        (pixels[bottom] + pixels[bottom + 1] + pixels[bottom + 2]) -
        (pixels[top] + pixels[top + 1] + pixels[top + 2])
      );
      const edge = gx + gy;
      
      if (edge > 50) {
        const gray = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;
        
        const scaleX = (window.innerWidth / VIDEO_WIDTH) * 0.9;
        const scaleY = (window.innerHeight / VIDEO_HEIGHT) * 0.9;
        
        framePoints.push({
          x: (x - VIDEO_WIDTH / 2) * scaleX,
          y: -(y - VIDEO_HEIGHT / 2) * scaleY,
          gray: gray
        });
      }
    }
  }

  trailHistory.unshift(framePoints);
  if (trailHistory.length > TRAIL_LENGTH) trailHistory.pop();

  updateParticleBuffer();
  isProcessing = false;
}

function updateParticleBuffer() {
  let idx = 0;
  
  for (let t = 0; t < trailHistory.length; t++) {
    const fade = Math.pow(1 - t / TRAIL_LENGTH, 0.5);
    const points = trailHistory[t];
    const spread = t * 3;
    
    for (const p of points) {
      if (idx >= positions.length) break;
      
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * spread;
      
      positions[idx] = p.x + Math.cos(angle) * dist;
      positions[idx + 1] = p.y + Math.sin(angle) * dist;
      positions[idx + 2] = t * 3;
      
      const c = p.gray * fade;
      colors[idx] = c;
      colors[idx + 1] = c;
      colors[idx + 2] = c;
      
      idx += 3;
    }
  }

  particles.geometry.attributes.position.needsUpdate = true;
  particles.geometry.attributes.color.needsUpdate = true;
  particles.geometry.setDrawRange(0, idx / 3);
}

function animate() {
  setTimeout(animate, 1000 / 60);
  
  // Плавный переход темы
  updateThemeTransition();
  
  // Обновляем аудио частицы
  if (audioReactiveEnabled && audioParticles) {
    updateAudioRings();
  }
  
  composer.render();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.resolution.set(window.innerWidth, window.innerHeight);
  
  if (surveillanceCanvas) {
    surveillanceCanvas.width = window.innerWidth;
    surveillanceCanvas.height = window.innerHeight;
  }
  if (rawVideoCanvas) {
    rawVideoCanvas.width = window.innerWidth;
    rawVideoCanvas.height = window.innerHeight;
  }
  if (audioCanvas) {
    audioCanvas.width = window.innerWidth;
    audioCanvas.height = window.innerHeight;
  }
}

function drawRawVideo() {
  if (!video || !rawVideoCtx) return;
  rawVideoCtx.drawImage(video, 0, 0, window.innerWidth, window.innerHeight);
}

// ============ UI TOGGLE (Z key) ============

let uiHidden = false;

function toggleUI() {
  uiHidden = !uiHidden;
  
  const titlebar = document.getElementById('titlebar');
  const controlPanel = document.getElementById('controlPanel');
  const hint = document.getElementById('uiHint');
  
  if (uiHidden) {
    titlebar?.classList.add('hidden');
    controlPanel?.classList.add('hidden');
    hint?.classList.add('hidden');
  } else {
    titlebar?.classList.remove('hidden');
    controlPanel?.classList.remove('hidden');
    hint?.classList.remove('hidden');
  }
}

function initUIToggle() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я') {
      toggleUI();
    }
  });
}


// ============ SURVEILLANCE EFFECT ============

function processSurveillanceFrame(imageData) {
  const pixels = imageData.data;
  const motionBlobs = detectMotion(pixels, VIDEO_WIDTH, VIDEO_HEIGHT);
  updateTracking(motionBlobs);
  drawSurveillanceOverlay();
}

function detectMotion(pixels, width, height) {
  const blobs = [];
  
  if (!prevFrameData) {
    return blobs;
  }
  
  const motionMap = new Uint8Array(width * height);
  const threshold = 30;
  
  for (let i = 0; i < pixels.length; i += 4) {
    const idx = i / 4;
    const diff = Math.abs(pixels[i] - prevFrameData[i]) +
                 Math.abs(pixels[i + 1] - prevFrameData[i + 1]) +
                 Math.abs(pixels[i + 2] - prevFrameData[i + 2]);
    
    if (diff > threshold * 3) motionMap[idx] = 255;
  }
  
  const visited = new Uint8Array(width * height);
  const gridSize = 20;
  
  for (let gy = 0; gy < height; gy += gridSize) {
    for (let gx = 0; gx < width; gx += gridSize) {
      let motionCount = 0;
      let sumX = 0, sumY = 0;
      
      for (let y = gy; y < Math.min(gy + gridSize, height); y++) {
        for (let x = gx; x < Math.min(gx + gridSize, width); x++) {
          const idx = y * width + x;
          if (motionMap[idx] && !visited[idx]) {
            motionCount++;
            sumX += x;
            sumY += y;
            visited[idx] = 1;
          }
        }
      }
      
      if (motionCount > gridSize * gridSize * 0.1) {
        blobs.push({
          x: sumX / motionCount,
          y: sumY / motionCount,
          size: motionCount,
          width: gridSize * 2,
          height: gridSize * 3
        });
      }
    }
  }
  
  return mergeBlobs(blobs);
}

function mergeBlobs(blobs) {
  const merged = [];
  const used = new Set();
  
  for (let i = 0; i < blobs.length; i++) {
    if (used.has(i)) continue;
    
    let blob = { ...blobs[i] };
    let minX = blob.x - blob.width / 2;
    let maxX = blob.x + blob.width / 2;
    let minY = blob.y - blob.height / 2;
    let maxY = blob.y + blob.height / 2;
    
    for (let j = i + 1; j < blobs.length; j++) {
      if (used.has(j)) continue;
      
      const dist = Math.hypot(blob.x - blobs[j].x, blob.y - blobs[j].y);
      if (dist < 120) {
        used.add(j);
        minX = Math.min(minX, blobs[j].x - blobs[j].width / 2);
        maxX = Math.max(maxX, blobs[j].x + blobs[j].width / 2);
        minY = Math.min(minY, blobs[j].y - blobs[j].height / 2);
        maxY = Math.max(maxY, blobs[j].y + blobs[j].height / 2);
        blob.size += blobs[j].size;
      }
    }
    
    blob.x = (minX + maxX) / 2;
    blob.y = (minY + maxY) / 2;
    blob.width = Math.max(60, maxX - minX);
    blob.height = Math.max(80, maxY - minY);
    
    if (blob.size > 150) merged.push(blob);
  }
  
  merged.sort((a, b) => b.size - a.size);
  return merged.slice(0, MAX_TRACKED_OBJECTS);
}

function updateTracking(blobs) {
  const maxDist = 80;
  const usedBlobs = new Set();
  
  for (const obj of trackedObjects) {
    let bestBlob = null;
    let bestDist = maxDist;
    
    for (let i = 0; i < blobs.length; i++) {
      if (usedBlobs.has(i)) continue;
      
      const dist = Math.hypot(obj.x - blobs[i].x, obj.y - blobs[i].y);
      if (dist < bestDist) {
        bestDist = dist;
        bestBlob = i;
      }
    }
    
    if (bestBlob !== null) {
      usedBlobs.add(bestBlob);
      obj.x = obj.x * 0.7 + blobs[bestBlob].x * 0.3;
      obj.y = obj.y * 0.7 + blobs[bestBlob].y * 0.3;
      obj.width = obj.width * 0.8 + blobs[bestBlob].width * 0.2;
      obj.height = obj.height * 0.8 + blobs[bestBlob].height * 0.2;
      obj.confidence = Math.min(1, obj.confidence + 0.1);
    } else {
      obj.confidence -= 0.05;
    }
  }
  
  for (let i = 0; i < blobs.length; i++) {
    if (usedBlobs.has(i)) continue;
    
    trackedObjects.push({
      id: objectIdCounter++,
      x: blobs[i].x,
      y: blobs[i].y,
      width: blobs[i].width,
      height: blobs[i].height,
      confidence: 0.3
    });
  }
  
  trackedObjects = trackedObjects.filter(obj => obj.confidence > 0);
}

function drawSurveillanceOverlay() {
  const ctx = surveillanceCtx;
  const scaleX = window.innerWidth / VIDEO_WIDTH;
  const scaleY = window.innerHeight / VIDEO_HEIGHT;
  
  // Цвета в зависимости от темы
  const lineColor = isDarkTheme ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)';
  const accentColor = isDarkTheme ? [0, 255, 200] : [0, 100, 80];
  
  // Линии связи
  if (trackedObjects.length > 1) {
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    
    for (let i = 0; i < trackedObjects.length; i++) {
      for (let j = i + 1; j < trackedObjects.length; j++) {
        const obj1 = trackedObjects[i];
        const obj2 = trackedObjects[j];
        ctx.beginPath();
        ctx.moveTo(obj1.x * scaleX, obj1.y * scaleY);
        ctx.lineTo(obj2.x * scaleX, obj2.y * scaleY);
        ctx.stroke();
      }
    }
  }
  
  // Рамки объектов
  for (const obj of trackedObjects) {
    const x = obj.x * scaleX;
    const y = obj.y * scaleY;
    const w = obj.width * scaleX;
    const h = obj.height * scaleY;
    const alpha = Math.min(1, obj.confidence);
    
    ctx.strokeStyle = `rgba(${accentColor[0]}, ${accentColor[1]}, ${accentColor[2]}, ${alpha})`;
    ctx.lineWidth = 2;
    
    const cornerLen = 15;
    ctx.beginPath();
    ctx.moveTo(x - w/2, y - h/2 + cornerLen);
    ctx.lineTo(x - w/2, y - h/2);
    ctx.lineTo(x - w/2 + cornerLen, y - h/2);
    ctx.moveTo(x + w/2 - cornerLen, y - h/2);
    ctx.lineTo(x + w/2, y - h/2);
    ctx.lineTo(x + w/2, y - h/2 + cornerLen);
    ctx.moveTo(x + w/2, y + h/2 - cornerLen);
    ctx.lineTo(x + w/2, y + h/2);
    ctx.lineTo(x + w/2 - cornerLen, y + h/2);
    ctx.moveTo(x - w/2 + cornerLen, y + h/2);
    ctx.lineTo(x - w/2, y + h/2);
    ctx.lineTo(x - w/2, y + h/2 - cornerLen);
    ctx.stroke();
    
    ctx.fillStyle = `rgba(${accentColor[0]}, ${accentColor[1]}, ${accentColor[2]}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.font = '11px monospace';
    ctx.fillText(`[blob${obj.id}:id]`, x - w/2, y - h/2 - 15);
    ctx.fillText(`${Math.floor(obj.x * 100 + 200000)}.0`, x - w/2, y - h/2 - 3);
  }
  
  // Статус
  ctx.fillStyle = `rgba(${accentColor[0]}, ${accentColor[1]}, ${accentColor[2]}, 0.8)`;
  ctx.font = '12px monospace';
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  ctx.fillText(`REC ● ${timestamp}`, 10, window.innerHeight - 20);
  ctx.fillText(`OBJECTS: ${trackedObjects.length}`, 10, window.innerHeight - 5);
}

// ============ AUDIO REACTIVE ============

async function initAudio() {
  console.log('Initializing audio...');
  try {
    // В Electron используем desktopCapturer для захвата системного звука
    let sourceId = null;
    
    if (window.electronAPI?.getDesktopSources) {
      const sources = await window.electronAPI.getDesktopSources();
      console.log('Desktop sources:', sources);
      // Берём первый экран
      const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];
      if (screenSource) {
        sourceId = screenSource.id;
        console.log('Using source:', sourceId);
      }
    }
    
    if (!sourceId) {
      throw new Error('Не удалось получить источник для захвата аудио');
    }
    
    // Захватываем через getUserMedia с chromeMediaSource
    const constraints = {
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop'
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      }
    };
    
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    
    // Останавливаем видео — нужен только звук
    stream.getVideoTracks().forEach(track => track.stop());
    
    const audioTracks = stream.getAudioTracks();
    console.log('Audio tracks:', audioTracks.length);
    
    if (audioTracks.length === 0) {
      throw new Error('Нет аудио треков');
    }
    
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.85;
    audioData = new Uint8Array(analyser.frequencyBinCount);
    
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    
    console.log('System audio initialized!');
  } catch (err) {
    console.error('Audio init failed:', err);
    audioReactiveEnabled = false;
    const btn = document.getElementById('audioBtn');
    if (btn) btn.style.opacity = '0.5';
    audioCanvas.style.display = 'none';
  }
}

function createAudioRings() {
  const totalParticles = AUDIO_RINGS * PARTICLES_PER_RING;
  const geometry = new THREE.BufferGeometry();
  
  audioPositions = new Float32Array(totalParticles * 3);
  audioColors = new Float32Array(totalParticles * 3);
  audioSizes = new Float32Array(totalParticles);
  
  // Инициализируем частицы по кольцам
  let idx = 0;
  for (let ring = 0; ring < AUDIO_RINGS; ring++) {
    const baseRadius = 30 + ring * 25;
    
    for (let i = 0; i < PARTICLES_PER_RING; i++) {
      const angle = (i / PARTICLES_PER_RING) * Math.PI * 2;
      
      audioPositions[idx * 3] = Math.cos(angle) * baseRadius;
      audioPositions[idx * 3 + 1] = Math.sin(angle) * baseRadius;
      audioPositions[idx * 3 + 2] = ring * 5;
      
      // Цвет: белый с лёгким cyan оттенком
      audioColors[idx * 3] = 0.8 + ring * 0.02;
      audioColors[idx * 3 + 1] = 1;
      audioColors[idx * 3 + 2] = 0.9 + ring * 0.01;
      
      audioSizes[idx] = 2;
      idx++;
    }
  }
  
  geometry.setAttribute('position', new THREE.BufferAttribute(audioPositions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(audioColors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(audioSizes, 1));
  
  const material = new THREE.PointsMaterial({
    size: 2.5,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  });
  
  audioParticles = new THREE.Points(geometry, material);
  audioParticles.visible = false;
  scene.add(audioParticles);
}

function updateAudioRings() {
  if (!analyser || !audioData) return;
  
  analyser.getByteFrequencyData(audioData);
  
  const time = Date.now() * 0.001;
  
  // Вычисляем уровни по частотам
  let bassLevel = 0, midLevel = 0, highLevel = 0;
  const len = audioData.length;
  for (let i = 0; i < len * 0.15; i++) bassLevel += audioData[i];
  for (let i = Math.floor(len * 0.15); i < len * 0.5; i++) midLevel += audioData[i];
  for (let i = Math.floor(len * 0.5); i < len; i++) highLevel += audioData[i];
  
  bassLevel = bassLevel / (len * 0.15) / 255;
  midLevel = midLevel / (len * 0.35) / 255;
  highLevel = highLevel / (len * 0.5) / 255;
  
  let idx = 0;
  for (let ring = 0; ring < AUDIO_RINGS; ring++) {
    const baseRadius = 30 + ring * 25;
    const ringOffset = time * (0.5 + ring * 0.1);
    
    // Каждое кольцо реагирует на свою частоту
    const freqStart = Math.floor((ring / AUDIO_RINGS) * audioData.length);
    const freqEnd = Math.floor(((ring + 1) / AUDIO_RINGS) * audioData.length);
    
    for (let i = 0; i < PARTICLES_PER_RING; i++) {
      const angle = (i / PARTICLES_PER_RING) * Math.PI * 2 + ringOffset;
      
      // Получаем частоту для этой частицы
      const freqIdx = freqStart + Math.floor((i / PARTICLES_PER_RING) * (freqEnd - freqStart));
      const freq = audioData[freqIdx] / 255;
      
      // Зубчатый контур — радиус меняется от частоты
      const spikes = 12 + ring * 2;
      const spikeAngle = angle * spikes;
      const spikeAmount = Math.sin(spikeAngle) * 0.3 * (1 + freq * 2);
      
      // Радиус с деформацией от звука
      const radius = baseRadius * (1 + spikeAmount + freq * 0.5 + bassLevel * 0.3);
      
      // Спиральное смещение
      const spiralZ = Math.sin(angle * 3 + time * 2) * 10 * (1 + midLevel);
      
      audioPositions[idx * 3] = Math.cos(angle) * radius;
      audioPositions[idx * 3 + 1] = Math.sin(angle) * radius;
      audioPositions[idx * 3 + 2] = spiralZ + ring * 3;
      
      // Цвет меняется от частоты
      const brightness = 0.5 + freq * 0.5;
      const cyan = 0.7 + highLevel * 0.3;
      audioColors[idx * 3] = brightness * 0.9;
      audioColors[idx * 3 + 1] = brightness * cyan;
      audioColors[idx * 3 + 2] = brightness * 0.8;
      
      idx++;
    }
  }
  
  audioParticles.geometry.attributes.position.needsUpdate = true;
  audioParticles.geometry.attributes.color.needsUpdate = true;
  
  // Вращение
  audioParticles.rotation.z += 0.005 + bassLevel * 0.02;
  audioParticles.rotation.x = Math.sin(time * 0.3) * 0.3;
  audioParticles.rotation.y = Math.cos(time * 0.2) * 0.2;
}


// ============ UI FUNCTIONS ============

async function initWelcomeScreen() {
  // Load settings from file
  await loadAppSettings();
  
  // Skip welcome screen if not first launch
  if (appSettings && !appSettings.firstLaunch) {
    hideWelcomeScreen();
    loadCameras();
    startCamera();
    return;
  }
  
  // Load cameras for welcome screen
  await loadWelcomeCameras();
  
  // Theme selector
  document.querySelectorAll('.theme-option').forEach(option => {
    option.addEventListener('click', () => {
      document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
      
      const theme = option.dataset.theme;
      const newIsDark = theme !== 'light';
      
      if (newIsDark !== isDarkTheme) {
        // Плавный переход для Three.js сцены
        themeTransition.fromColor = scene.background.clone();
        themeTransition.toColor = new THREE.Color(newIsDark ? 0x030712 : 0xf8fafc);
        themeTransition.progress = 0;
        themeTransition.active = true;
        
        isDarkTheme = newIsDark;
        
        if (isDarkTheme) {
          particles.material.blending = THREE.AdditiveBlending;
          document.body.classList.remove('light-theme');
        } else {
          particles.material.blending = THREE.SubtractiveBlending;
          document.body.classList.add('light-theme');
        }
      }
    });
  });
  
  // Camera select change
  document.getElementById('welcomeCameraSelect')?.addEventListener('change', (e) => {
    selectedDeviceId = e.target.value;
  });
  
  // Quality select change
  document.getElementById('welcomeQualitySelect')?.addEventListener('change', (e) => {
    selectedQuality = parseInt(e.target.value);
  });
  
  // Continue button -> Save settings and start app
  document.getElementById('continueBtn')?.addEventListener('click', async () => {
    // Save settings
    await saveAppSettings();
    
    hideWelcomeScreen();
    loadCameras();
    startCamera();
  });
  
  // Apply saved settings to UI
  applySettingsToUI();
  
  // Check if user is logged in
  checkAuth();
}

async function loadAppSettings() {
  try {
    if (window.electronAPI?.loadSettings) {
      appSettings = await window.electronAPI.loadSettings();
    } else {
      // Fallback to localStorage for browser
      const saved = localStorage.getItem('appSettings');
      appSettings = saved ? JSON.parse(saved) : getDefaultSettings();
    }
  } catch (e) {
    console.error('Error loading settings:', e);
    appSettings = getDefaultSettings();
  }
  
  // Apply settings
  if (appSettings) {
    isDarkTheme = appSettings.theme !== 'light';
    selectedDeviceId = appSettings.camera || null;
    selectedQuality = parseInt(appSettings.quality) || 720;
  }
}

async function saveAppSettings() {
  const theme = document.querySelector('.theme-option.selected')?.dataset.theme || 'dark';
  const camera = document.getElementById('welcomeCameraSelect')?.value || selectedDeviceId || '';
  const quality = document.getElementById('welcomeQualitySelect')?.value || String(selectedQuality) || '720';
  
  appSettings = {
    ...appSettings,
    firstLaunch: false,
    theme,
    camera,
    quality
  };
  
  try {
    if (window.electronAPI?.saveSettings) {
      await window.electronAPI.saveSettings(appSettings);
    } else {
      // Fallback to localStorage
      localStorage.setItem('appSettings', JSON.stringify(appSettings));
    }
  } catch (e) {
    console.error('Error saving settings:', e);
  }
}

function getDefaultSettings() {
  return {
    firstLaunch: true,
    theme: 'dark',
    camera: '',
    quality: '720',
    profiles: [],
    currentProfile: ''
  };
}

function applySettingsToUI() {
  if (!appSettings) return;
  
  // Theme
  if (appSettings.theme === 'light') {
    document.body.classList.add('light-theme');
    isDarkTheme = false;
    scene.background = new THREE.Color(0xf8fafc);
    particles.material.blending = THREE.SubtractiveBlending;
    document.querySelector('[data-theme="light"]')?.classList.add('selected');
    document.querySelector('[data-theme="dark"]')?.classList.remove('selected');
  }
  
  // Quality
  const qualitySelect = document.getElementById('welcomeQualitySelect');
  if (qualitySelect && appSettings.quality) {
    qualitySelect.value = appSettings.quality;
  }
}

async function loadWelcomeCameras() {
  try {
    // Request camera permission first
    await navigator.mediaDevices.getUserMedia({ video: true }).then(s => {
      s.getTracks().forEach(t => t.stop());
    });
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    availableCameras = devices.filter(d => d.kind === 'videoinput');
    
    const select = document.getElementById('welcomeCameraSelect');
    if (!select) return;
    
    select.innerHTML = '';
    availableCameras.forEach((cam, i) => {
      const option = document.createElement('option');
      option.value = cam.deviceId;
      option.textContent = cam.label || `Camera ${i + 1}`;
      if (appSettings?.camera && cam.deviceId === appSettings.camera) {
        option.selected = true;
        selectedDeviceId = cam.deviceId;
      }
      select.appendChild(option);
    });
    
    // Select first camera if none saved
    if (!selectedDeviceId && availableCameras.length > 0) {
      selectedDeviceId = availableCameras[0].deviceId;
    }
  } catch (err) {
    console.error('Error loading cameras:', err);
    const select = document.getElementById('welcomeCameraSelect');
    if (select) {
      select.innerHTML = '<option value="">No cameras found</option>';
    }
  }
}

async function checkAuth() {
  const user = localStorage.getItem('user');
  if (user) {
    const userData = JSON.parse(user);
    if (userData.uid && userData.emailVerified) {
      updateUserUI(userData);
      hideWelcomeScreen();
      return;
    }
  }
  // Show welcome screen if not logged in
}

function updateUserUI(userData) {
  const userName = document.getElementById('userName');
  const userEmail = document.getElementById('userEmail');
  const userAvatar = document.getElementById('userAvatar');
  const signInBtn = document.getElementById('signInBtn');
  const signOutBtn = document.getElementById('signOutBtn');
  
  if (userName) userName.textContent = userData.displayName || 'User';
  if (userEmail) userEmail.textContent = userData.email || '';
  if (userAvatar && userData.photoURL) {
    userAvatar.innerHTML = `<img src="${userData.photoURL}" alt="Avatar">`;
  }
  if (signInBtn) signInBtn.style.display = 'none';
  if (signOutBtn) signOutBtn.style.display = 'flex';
}

function hideWelcomeScreen() {
  const welcome = document.getElementById('welcomeScreen');
  const titlebar = document.getElementById('titlebar');
  const controlPanel = document.getElementById('controlPanel');
  
  if (welcome) {
    welcome.classList.add('hidden');
    setTimeout(() => welcome.style.display = 'none', 500);
  }
  
  // Show app UI
  if (titlebar) titlebar.style.display = 'flex';
  if (controlPanel) controlPanel.style.display = 'flex';
  
  // Init UI toggle
  initUIToggle();
}

function toggleControlBtn(id) {
  const btn = document.getElementById(id);
  if (btn) {
    btn.classList.toggle('active');
  }
}

function toggleProfile() {
  // Проверяем авторизацию
  const user = localStorage.getItem('user');
  if (!user) {
    // Не авторизован — показываем welcome screen
    const welcome = document.getElementById('welcomeScreen');
    if (welcome) {
      welcome.style.display = 'flex';
      welcome.classList.remove('hidden');
    }
    return;
  }
  
  const panel = document.getElementById('profilePanel');
  const settings = document.getElementById('settingsPanel');
  
  if (settings) settings.style.display = 'none';
  
  if (panel) {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }
}

// Функция удалена - авторизация только через сайт

async function signOut() {
  try {
    await firebaseSignOut(auth);
  } catch (e) {}
  
  localStorage.removeItem('user');
  
  // Stop camera
  stopCamera();
  
  // Hide app UI
  const titlebar = document.getElementById('titlebar');
  const controlPanel = document.getElementById('controlPanel');
  const profilePanel = document.getElementById('profilePanel');
  
  if (titlebar) titlebar.style.display = 'none';
  if (controlPanel) controlPanel.style.display = 'none';
  if (profilePanel) profilePanel.style.display = 'none';
  
  // Show welcome screen
  const welcome = document.getElementById('welcomeScreen');
  if (welcome) {
    welcome.style.display = 'flex';
    welcome.classList.remove('hidden');
  }
}

function loadUserData() {
  const userData = localStorage.getItem('user');
  const userName = document.getElementById('userName');
  const userEmail = document.getElementById('userEmail');
  const userAvatar = document.getElementById('userAvatar');
  const signInBtn = document.getElementById('signInBtn');
  const signOutBtn = document.getElementById('signOutBtn');
  
  if (userData) {
    const user = JSON.parse(userData);
    if (userName) userName.textContent = user.name;
    if (userEmail) userEmail.textContent = user.email;
    if (userAvatar) {
      if (user.avatar) {
        userAvatar.innerHTML = `<img src="${user.avatar}" alt="Avatar">`;
      } else {
        userAvatar.textContent = user.name.charAt(0).toUpperCase();
      }
    }
    if (signInBtn) signInBtn.style.display = 'none';
    if (signOutBtn) signOutBtn.style.display = 'flex';
  } else {
    if (userName) userName.textContent = 'Guest User';
    if (userEmail) userEmail.textContent = 'Not signed in';
    if (userAvatar) userAvatar.textContent = '👤';
    if (signInBtn) signInBtn.style.display = 'flex';
    if (signOutBtn) signOutBtn.style.display = 'none';
  }
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(34, 197, 94, 0.9);
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 10001;
    animation: slideUp 0.3s ease;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}


// ============ PROFILES & EFFECTS ============

let profiles = [];
let currentProfile = 'default';

function loadProfiles() {
  // Load from appSettings if available
  if (appSettings?.profiles) {
    profiles = appSettings.profiles;
    currentProfile = appSettings.currentProfile || '';
  } else {
    profiles = [];
  }
  renderProfiles();
}

async function saveProfiles() {
  if (appSettings) {
    appSettings.profiles = profiles;
    appSettings.currentProfile = currentProfile;
    
    try {
      if (window.electronAPI?.saveSettings) {
        await window.electronAPI.saveSettings(appSettings);
      } else {
        localStorage.setItem('appSettings', JSON.stringify(appSettings));
      }
    } catch (e) {
      console.error('Error saving profiles:', e);
    }
  }
}

function renderProfiles() {
  const list = document.getElementById('profilesList');
  if (!list) return;
  
  list.innerHTML = profiles.map(p => `
    <div class="profile-item ${p.id === currentProfile ? 'active' : ''}" data-profile="${p.id}">
      <div class="profile-item-info">
        <div class="profile-item-icon">${p.icon}</div>
        <div>
          <div class="profile-item-name">${p.name}</div>
          <div class="profile-item-effects">${p.effects.join(', ')}</div>
        </div>
      </div>
      ${p.id !== 'default' ? '<button class="profile-action-btn delete-profile" title="Delete">🗑️</button>' : ''}
    </div>
  `).join('');
  
  // Re-attach event listeners
  list.querySelectorAll('.profile-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.profile-action-btn')) return;
      document.querySelectorAll('.profile-item').forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      loadProfile(item.dataset.profile);
    });
  });
  
  list.querySelectorAll('.delete-profile').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const profileId = btn.closest('.profile-item').dataset.profile;
      deleteProfile(profileId);
    });
  });
}

function loadProfile(profileId) {
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return;
  
  currentProfile = profileId;
  localStorage.setItem('currentProfile', profileId);
  
  // Apply effects
  particlesEnabled = profile.effects.includes('particles');
  surveillanceEnabled = profile.effects.includes('tracking');
  audioReactiveEnabled = profile.effects.includes('audio');
  bloomEnabled = profile.effects.includes('bloom');
  isCameraOn = profile.effects.includes('camera');
  
  // Update UI
  updateEffectsUI();
  showNotification(`Profile "${profile.name}" loaded`);
}

function createNewProfile() {
  console.log('createNewProfile called');
  const name = prompt('Enter profile name:');
  console.log('Profile name:', name);
  if (!name) return;
  
  const icons = ['🎨', '⚡', '🌟', '🔥', '💎', '🎭', '🌈', '🎪'];
  const icon = icons[Math.floor(Math.random() * icons.length)];
  
  const newProfile = {
    id: 'profile_' + Date.now(),
    name: name,
    icon: icon,
    effects: ['particles', 'bloom', 'camera']
  };
  
  profiles.push(newProfile);
  saveProfiles();
  renderProfiles();
  showNotification(`Profile "${name}" created`);
}

function deleteProfile(profileId) {
  if (profileId === 'default') return;
  
  profiles = profiles.filter(p => p.id !== profileId);
  saveProfiles();
  renderProfiles();
  
  if (currentProfile === profileId) {
    loadProfile('default');
  }
  showNotification('Profile deleted');
}

function applySelectedEffects() {
  const effectsGrid = document.getElementById('effectsGrid');
  if (!effectsGrid) return;
  
  const activeEffects = [];
  effectsGrid.querySelectorAll('.effect-card.active').forEach(card => {
    activeEffects.push(card.dataset.effect);
  });
  
  particlesEnabled = activeEffects.includes('particles');
  surveillanceEnabled = activeEffects.includes('tracking');
  audioReactiveEnabled = activeEffects.includes('audio');
  bloomEnabled = activeEffects.includes('bloom');
  isCameraOn = activeEffects.includes('camera');
  
  updateEffectsUI();
}

function updateEffectsUI() {
  // Update control panel buttons
  const ctrlParticles = document.getElementById('ctrl-particles');
  const ctrlTracking = document.getElementById('ctrl-tracking');
  const ctrlAudio = document.getElementById('ctrl-audio');
  const ctrlBloom = document.getElementById('ctrl-bloom');
  const ctrlCamera = document.getElementById('ctrl-camera');
  
  if (ctrlParticles) ctrlParticles.classList.toggle('active', particlesEnabled);
  if (ctrlTracking) ctrlTracking.classList.toggle('active', surveillanceEnabled);
  if (ctrlAudio) ctrlAudio.classList.toggle('active', audioReactiveEnabled);
  if (ctrlBloom) ctrlBloom.classList.toggle('active', bloomEnabled);
  if (ctrlCamera) ctrlCamera.classList.toggle('active', isCameraOn);
  
  // Apply effects
  if (renderer) renderer.domElement.style.display = particlesEnabled ? 'block' : 'none';
  if (rawVideoCanvas) rawVideoCanvas.style.display = particlesEnabled ? 'none' : 'block';
  if (surveillanceCanvas) surveillanceCanvas.style.display = surveillanceEnabled ? 'block' : 'none';
  if (bloomPass) bloomPass.strength = bloomEnabled ? 1.5 : 0;
  if (audioParticles) audioParticles.visible = audioReactiveEnabled;
  
  // Update effects grid in welcome screen
  document.querySelectorAll('.effect-card').forEach(card => {
    const effect = card.dataset.effect;
    const isActive = 
      (effect === 'particles' && particlesEnabled) ||
      (effect === 'tracking' && surveillanceEnabled) ||
      (effect === 'audio' && audioReactiveEnabled) ||
      (effect === 'bloom' && bloomEnabled) ||
      (effect === 'camera' && isCameraOn);
    card.classList.toggle('active', isActive);
  });
}

// ============ THEME ICON ============

function updateThemeIcon() {
  const btn = document.getElementById('ctrl-theme');
  if (btn) {
    btn.innerHTML = isDarkTheme ? '<i class="ph ph-moon"></i>' : '<i class="ph ph-sun"></i>';
  }
}

// Initialize profiles on load
loadProfiles();
