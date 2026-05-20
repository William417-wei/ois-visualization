/**
 * 簡化互動版 OIS 原理模擬器核心邏輯
 */

// --- 狀態管理 ---
const state = {
  oisMode: 'off',          // 'off' (關閉), 'lens' (鏡片防震), 'sensor' (感光元件防震)
  autoShakeActive: false,  // 自動晃動狀態
  
  // 晃動物理量 (以 canvas 中心為基準的偏移)
  shakeOffset: { x: 0, y: 0 },
  theta: 0.0,              // 手機傾斜角度 (弧度)
  
  // OIS 位移量 (相對於手機機身)
  lensShift: 0.0,
  sensorShift: 0.0,
  
  // 觀景窗位置 (用於運動模糊與平滑)
  viewfinderPos: { x: 0, y: 0 },
  viewfinderHistory: [],
  
  // 物理常數
  focalLength: 110,
  maxLensShift: 20,
  maxSensorShift: 16,
  
  // 互動狀態
  isDragging: false,
  hasDragged: false,
  dragStart: { x: 0, y: 0 },
  shakeStart: { x: 0, y: 0 }
};

// --- DOM 元素 ---
const elements = {
  physicalCanvas: document.getElementById('physical-canvas'),
  viewfinderCanvas: document.getElementById('viewfinder-canvas'),
  btnOisToggle: document.getElementById('btn-ois-toggle'),
  btnTypeLens: document.getElementById('btn-type-lens'),
  btnTypeSensor: document.getElementById('btn-type-sensor'),
  btnAutoShake: document.getElementById('btn-auto-shake'),
  btnReset: document.getElementById('btn-reset'),
  badgeOisMode: document.getElementById('badge-ois-mode'),
  dragOverlay: document.getElementById('drag-overlay'),
  infoText: document.getElementById('info-text')
};

const ctxs = {
  physical: elements.physicalCanvas.getContext('2d'),
  viewfinder: elements.viewfinderCanvas.getContext('2d')
};

// --- Canvas 響應式解析度調整 ---
function resizeCanvas(canvas, ctx, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.scale(dpr, dpr);
}

function handleResize() {
  const containerW = elements.physicalCanvas.parentElement.clientWidth;
  resizeCanvas(elements.physicalCanvas, ctxs.physical, containerW, 380);
  resizeCanvas(elements.viewfinderCanvas, ctxs.viewfinder, elements.viewfinderCanvas.parentElement.clientWidth, 380);
}

window.addEventListener('resize', handleResize);

// --- 互動事件監聽 (Drag & Touch) ---
function initInteraction() {
  const canvasContainer = elements.physicalCanvas.parentElement;
  
  // 滑鼠按下
  canvasContainer.addEventListener('mousedown', (e) => {
    state.isDragging = true;
    state.hasDragged = true;
    state.autoShakeActive = false; // 拖曳時自動關閉自動晃動
    elements.btnAutoShake.classList.remove('active');
    elements.btnAutoShake.innerText = '啟動自動晃動';
    
    // 隱藏拖曳提示
    elements.dragOverlay.style.opacity = '0';
    
    const rect = canvasContainer.getBoundingClientRect();
    state.dragStart.x = e.clientX - rect.left;
    state.dragStart.y = e.clientY - rect.top;
    
    state.shakeStart.x = state.shakeOffset.x;
    state.shakeStart.y = state.shakeOffset.y;
    
    e.preventDefault();
  });
  
  // 滑鼠移動
  window.addEventListener('mousemove', (e) => {
    if (!state.isDragging) return;
    
    const rect = canvasContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // 計算拖曳位移
    const dx = mouseX - state.dragStart.x;
    const dy = mouseY - state.dragStart.y;
    
    // 限幅於 +/- 100 像素內，防止手機飛出畫面
    state.shakeOffset.x = Math.max(-100, Math.min(100, state.shakeStart.x + dx));
    state.shakeOffset.y = Math.max(-100, Math.min(100, state.shakeStart.y + dy));
  });
  
  // 滑鼠放開
  window.addEventListener('mouseup', () => {
    state.isDragging = false;
  });
  
  // 行動端觸控支援
  canvasContainer.addEventListener('touchstart', (e) => {
    state.isDragging = true;
    state.hasDragged = true;
    state.autoShakeActive = false;
    elements.btnAutoShake.classList.remove('active');
    elements.btnAutoShake.innerText = '啟動自動晃動';
    elements.dragOverlay.style.opacity = '0';
    
    const rect = canvasContainer.getBoundingClientRect();
    state.dragStart.x = e.touches[0].clientX - rect.left;
    state.dragStart.y = e.touches[0].clientY - rect.top;
    state.shakeStart.x = state.shakeOffset.x;
    state.shakeStart.y = state.shakeOffset.y;
    
    e.preventDefault();
  });
  
  window.addEventListener('touchmove', (e) => {
    if (!state.isDragging) return;
    
    const rect = canvasContainer.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const touchY = e.touches[0].clientY - rect.top;
    
    const dx = touchX - state.dragStart.x;
    const dy = touchY - state.dragStart.y;
    
    state.shakeOffset.x = Math.max(-100, Math.min(100, state.shakeStart.x + dx));
    state.shakeOffset.y = Math.max(-100, Math.min(100, state.shakeStart.y + dy));
  });
  
  window.addEventListener('touchend', () => {
    state.isDragging = false;
  });

  // OIS 主開關切換
  elements.btnOisToggle.addEventListener('click', () => {
    const isCurrentlyOn = state.oisMode !== 'off';
    const newMode = isCurrentlyOn ? 'off' : getSelectedType();
    
    state.oisMode = newMode;
    updateUI();
  });

  // OIS 類型切換 (Lens vs Sensor)
  const typeBtns = [elements.btnTypeLens, elements.btnTypeSensor];
  typeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      typeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // 如果 OIS 是開啟狀態，直接套用新的 OIS 類型
      if (state.oisMode !== 'off') {
        state.oisMode = btn.dataset.type;
      }
      updateUI();
    });
  });

  // 自動晃動
  elements.btnAutoShake.addEventListener('click', () => {
    state.autoShakeActive = !state.autoShakeActive;
    if (state.autoShakeActive) {
      elements.btnAutoShake.classList.add('active');
      elements.btnAutoShake.innerText = '停止自動晃動';
      elements.dragOverlay.style.opacity = '0';
    } else {
      elements.btnAutoShake.classList.remove('active');
      elements.btnAutoShake.innerText = '啟動自動晃動';
    }
  });

  // 重設位置
  elements.btnReset.addEventListener('click', () => {
    state.shakeOffset = { x: 0, y: 0 };
    state.theta = 0;
    state.autoShakeActive = false;
    elements.btnAutoShake.classList.remove('active');
    elements.btnAutoShake.innerText = '啟動自動晃動';
    elements.dragOverlay.style.opacity = '1';
  });
}

function getSelectedType() {
  return elements.btnTypeLens.classList.contains('active') ? 'lens' : 'sensor';
}

function updateUI() {
  const isOisON = state.oisMode !== 'off';
  const toggleBtn = elements.btnOisToggle;
  const badge = elements.badgeOisMode;
  const infoText = elements.infoText;
  
  // 更新開關按鈕樣式
  if (isOisON) {
    toggleBtn.classList.add('active');
    toggleBtn.querySelector('.toggle-status').innerText = 'OIS 已開啟 (ON)';
    
    badge.className = 'badge-mode active-ois';
    
    if (state.oisMode === 'lens') {
      badge.innerText = 'LENS-SHIFT OIS';
      infoText.innerHTML = `
        <strong>【鏡片位移式 OIS 開啟】</strong> 手指拖曳手機晃動時，內部的<strong>音圈馬達 (VCM)</strong> 會推動藍色鏡片進行<strong>反向補償</strong>。光線經過偏折後，能完美匯聚在感光元件的中心（綠點），右側照片保持完全靜止清晰！
      `;
    } else {
      badge.innerText = 'SENSOR-SHIFT OIS';
      infoText.innerHTML = `
        <strong>【感光元件位移式 OIS 開啟】</strong> 手指拖曳手機晃動時，鏡片不動，而是由<strong>感光元件 (Sensor)</strong> 進行<strong>反向平移</strong>，主動迎合偏移的光點。同樣可以將對焦點鎖定在感測器中心，照片保持靜止清晰！
      `;
    }
  } else {
    toggleBtn.classList.remove('active');
    toggleBtn.querySelector('.toggle-status').innerText = 'OIS 已關閉 (OFF)';
    
    badge.className = 'badge-mode off';
    badge.innerText = 'OIS OFF';
    
    infoText.innerHTML = `
      <strong>【OIS 關閉】</strong> 拖曳手機晃動時，鏡片與感光元件跟著機身一起偏移。光斑在感應器上劇烈移動（紅點），導致右側照片產生劇烈晃動與運動模糊。
    `;
  }
}

// --- 物理引擎 ---
let lastTime = performance.now();

function updatePhysics(currentTime) {
  const dt = (currentTime - lastTime) / 1000;
  lastTime = currentTime;
  
  // 1. 自動晃動或手動回彈
  if (state.autoShakeActive) {
    const t = currentTime / 1000;
    // 簡單的圓形晃動 + 正弦波晃動
    state.shakeOffset.x = Math.sin(t * 3.5) * 45 + Math.cos(t * 1.8) * 15;
    state.shakeOffset.y = Math.cos(t * 3.1) * 35 + Math.sin(t * 2.2) * 10;
  } else if (!state.isDragging) {
    // 釋放滑鼠後，手機像彈簧一樣平滑回彈到中心
    state.shakeOffset.x += (0 - state.shakeOffset.x) * 0.12;
    state.shakeOffset.y += (0 - state.shakeOffset.y) * 0.12;
  }
  
  // 將垂直晃動 (shakeOffset.y) 映射到手機的傾斜角度 theta
  // 向上拖曳 -> 傾斜向上，向下拖曳 -> 傾斜向下
  state.theta = state.shakeOffset.y * 0.0018; // 弧度
  
  // 2. 計算 OIS 馬達補償
  // 理想位移：y_comp = f * theta
  const targetComp = state.theta * state.focalLength;
  const motorLerp = 0.25; // 模擬馬達反應速度
  
  if (state.oisMode === 'lens') {
    // 鏡片反向位移
    const idealShift = -targetComp;
    state.lensShift += (idealShift - state.lensShift) * motorLerp;
    state.sensorShift = 0.0;
  } else if (state.oisMode === 'sensor') {
    // 感光元件反向位移
    const idealShift = -targetComp;
    state.sensorShift += (idealShift - state.sensorShift) * motorLerp;
    state.lensShift = 0.0;
  } else {
    // OIS 關閉時，馬達歸位
    state.lensShift += (0 - state.lensShift) * 0.15;
    state.sensorShift += (0 - state.sensorShift) * 0.15;
  }
  
  // 3. 計算觀景窗的晃動位移
  // 理想補償因子
  let oisFactor = 0;
  if (state.oisMode === 'lens') {
    oisFactor = -state.lensShift / (state.theta * state.focalLength || 1);
  } else if (state.oisMode === 'sensor') {
    oisFactor = -state.sensorShift / (state.theta * state.focalLength || 1);
  }
  oisFactor = Math.max(0, Math.min(1.0, oisFactor)); // 限制在 0~100% 之間
  
  // 計算最終殘餘晃動量
  const residualFactor = 1.0 - oisFactor;
  // 觀景窗 Y 方向晃動直接關聯於殘餘手震角度，X 方向加入少許殘餘水平晃動
  const targetViewY = state.shakeOffset.y * residualFactor;
  const targetViewX = state.shakeOffset.x * residualFactor;
  
  state.viewfinderPos.x += (targetViewX - state.viewfinderPos.x) * 0.3;
  state.viewfinderPos.y += (targetViewY - state.viewfinderPos.y) * 0.3;
  
  // 記錄歷史位置以供運動模糊
  state.viewfinderHistory.push({ x: state.viewfinderPos.x, y: state.viewfinderPos.y });
  if (state.viewfinderHistory.length > 5) {
    state.viewfinderHistory.shift();
  }
}

// --- 繪圖引擎 ---

// 輔助函式：繪製一個波浪形的彈簧片 (懸浮結構)
function drawSpring(ctx, startX, startY, endX, endY, numCoils = 6, width = 6) {
  ctx.save();
  ctx.strokeStyle = '#9d4edd'; // 紫色代表機械結構 (Spring)
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  
  const dx = endX - startX;
  const dy = endY - startY;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy; // 垂直向量
  const py = ux;
  
  for (let i = 0; i <= numCoils; i++) {
    const t = i / numCoils;
    const x = startX + dx * t;
    const y = startY + dy * t;
    if (i === 0 || i === numCoils) {
      ctx.lineTo(x, y);
    } else {
      const offset = (i % 2 === 0 ? 1 : -1) * width;
      ctx.lineTo(x + px * offset, y + py * offset);
    }
  }
  ctx.stroke();
  ctx.restore();
}

// 1. 繪製左側相機內部結構 (對應簡報：光、機、電元件與原理)
function drawPhysical() {
  const canvas = elements.physicalCanvas;
  const ctx = ctxs.physical;
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  
  ctx.clearRect(0, 0, w, h);
  
  // 繪製背景格線
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
  ctx.lineWidth = 1;
  const grid = 30;
  for (let x = 0; x < w; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  
  const cx = w / 2;
  const cy = h / 2;
  
  // 畫布中心在手震位置 (x, y)，並配合傾斜角度旋轉
  ctx.save();
  ctx.translate(cx + state.shakeOffset.x, cy + state.shakeOffset.y);
  ctx.rotate(state.theta);
  
  // A. 繪製相機鏡筒外殼 (機 - 鏡筒結構)
  ctx.fillStyle = '#0a0d1a';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.roundRect(-120, -70, 240, 140, 15);
  ctx.fill();
  ctx.stroke();
  
  // 繪製光軸 (Camera Axis - 虛線)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(-115, 0);
  ctx.lineTo(115, 0);
  ctx.stroke();
  ctx.setLineDash([]);
  
  // B. 電學元件 (電) - 陀螺儀感測器、控制晶片 (MCU)
  // 陀螺儀 (Gyro Sensor)
  const gyroX = -95, gyroY = -52, gyroW = 35, gyroH = 22;
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#eab308'; // 黃色代表電學
  ctx.lineWidth = 1.5;
  ctx.fillRect(gyroX, gyroY, gyroW, gyroH);
  ctx.strokeRect(gyroX, gyroY, gyroW, gyroH);
  
  ctx.fillStyle = '#eab308';
  ctx.font = '8px Outfit, system-ui';
  ctx.fillText('GYRO', gyroX + 5, gyroY + 14);
  
  // 若偵測到抖動，陀螺儀亮黃光
  if (Math.abs(state.theta) > 0.001) {
    ctx.fillStyle = 'rgba(234, 179, 8, 0.25)';
    ctx.fillRect(gyroX, gyroY, gyroW, gyroH);
  }
  
  // 控制晶片 (MCU / Control Chip)
  const mcuX = -95, mcuY = 30, mcuW = 35, mcuH = 22;
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#eab308';
  ctx.lineWidth = 1.5;
  ctx.fillRect(mcuX, mcuY, mcuW, mcuH);
  ctx.strokeRect(mcuX, mcuY, mcuW, mcuH);
  
  ctx.fillStyle = '#eab308';
  ctx.fillText('MCU', mcuX + 7, mcuY + 14);
  
  // 繪製電路板金屬導線與電流訊號 (電 - 微控制器與電源)
  ctx.strokeStyle = 'rgba(234, 179, 8, 0.2)';
  ctx.lineWidth = 1.5;
  // 導線1：陀螺儀 -> MCU
  ctx.beginPath();
  ctx.moveTo(gyroX + gyroW / 2, gyroY + gyroH);
  ctx.lineTo(mcuX + mcuW / 2, mcuY);
  ctx.stroke();
  
  // 導線2：MCU -> 音圈馬達 (向上/向下分流)
  ctx.beginPath();
  ctx.moveTo(mcuX + mcuW, mcuY + mcuH / 2);
  ctx.lineTo(-40, mcuY + mcuH / 2);
  ctx.lineTo(-40, 36 + state.lensShift);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-40, mcuY + mcuH / 2);
  ctx.lineTo(-40, -36 + state.lensShift);
  ctx.stroke();
  
  // 若 OIS 開啟且手機在抖動，在導線上繪製流動的黃色電學訊號
  if (state.oisMode !== 'off' && Math.abs(state.shakeOffset.y) > 0.5) {
    ctx.save();
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#eab308';
    ctx.shadowBlur = 4;
    ctx.setLineDash([4, 8]);
    ctx.lineDashOffset = -performance.now() / 15;
    
    // 繪製流動信號
    ctx.beginPath();
    ctx.moveTo(gyroX + gyroW / 2, gyroY + gyroH);
    ctx.lineTo(mcuX + mcuW / 2, mcuY);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(mcuX + mcuW, mcuY + mcuH / 2);
    ctx.lineTo(-40, mcuY + mcuH / 2);
    ctx.lineTo(-40, 36 + state.lensShift);
    ctx.moveTo(-40, mcuY + mcuH / 2);
    ctx.lineTo(-40, -36 + state.lensShift);
    ctx.stroke();
    ctx.restore();
  }
  
  // C. 音圈馬達致動器 (電/機 - 致動器的馬達本體、線圈與磁鐵)
  // 永磁鐵 (Magnets) - 固定在相機外殼上 (上下各一，分紅白兩極代表 N/S)
  const magYTop = -48, magYBot = 48;
  ctx.fillStyle = '#ef4444'; // N極 紅
  ctx.fillRect(-52, magYTop - 4, 12, 8);
  ctx.fillStyle = '#3b82f6'; // S極 藍
  ctx.fillRect(-40, magYTop - 4, 12, 8);
  
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(-52, magYBot - 4, 12, 8);
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(-40, magYBot - 4, 12, 8);
  
  // 驅動線圈 (Coils) - 包在 OIS 鏡筒兩側，隨鏡片移動 (橘銅色)
  const coilYTop = -36 + state.lensShift;
  const coilYBot = 36 + state.lensShift;
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 3;
  ctx.beginPath();
  // 頂部線圈圈數線條
  ctx.moveTo(-50, coilYTop); ctx.lineTo(-32, coilYTop);
  ctx.moveTo(-50, coilYTop - 2); ctx.lineTo(-32, coilYTop - 2);
  // 底部線圈
  ctx.moveTo(-50, coilYBot); ctx.lineTo(-32, coilYBot);
  ctx.moveTo(-50, coilYBot + 2); ctx.lineTo(-32, coilYBot + 2);
  ctx.stroke();
  
  // D. 光學元件 (光) - 一般的透鏡組、防手震補償鏡片、感測器平面
  // 1. 一般固定透鏡組 (Fixed Lenses) - 前後各一片，固定於鏡筒
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1;
  // 前透鏡組
  ctx.beginPath(); ctx.ellipse(-65, 0, 4.5, 28, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  // 後透鏡組
  ctx.beginPath(); ctx.ellipse(-15, 0, 4.5, 28, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  
  // 2. 防手震補償鏡片 (OIS Lens) - 懸浮，可隨 VCM 上下平移
  const lensX = -40;
  const lensY = state.lensShift;
  
  // 鏡筒可動框架 (機 - 鏡筒結構)
  ctx.fillStyle = '#111827';
  ctx.strokeStyle = '#9d4edd'; // 紫色代表機械結構
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(lensX - 6, lensY - 26, 12, 52, 3);
  ctx.fill();
  ctx.stroke();
  
  // OIS 玻璃鏡片本身 (光)
  ctx.fillStyle = 'rgba(0, 240, 255, 0.15)';
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2;
  if (state.oisMode === 'lens' && Math.abs(state.lensShift) > 0.5) {
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 8;
  }
  ctx.beginPath();
  ctx.ellipse(lensX, lensY, 5, 20, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  
  // E. 機械懸浮結構 (機 - 懸浮與支撐結構 / 彈簧片)
  // 用波浪線繪製連結鏡框與外筒的懸浮彈簧片 (Spring)
  // 頂部彈簧片 (彈簧收縮/拉伸)
  drawSpring(ctx, lensX, magYTop + 4, lensX, lensY - 26, 5, 6);
  // 底部彈簧片
  drawSpring(ctx, lensX, magYBot - 4, lensX, lensY + 26, 5, 6);
  
  // F. 感光元件 (光/電 - 感測器平面)
  const sensorX = 70;
  const sensorY = state.sensorShift;
  
  // 如果是感測器防震 (Sensor-Shift)，感光元件四周也有懸浮彈簧片
  if (state.oisMode === 'sensor') {
    drawSpring(ctx, sensorX, magYTop + 4, sensorX, sensorY - 35, 5, 5);
    drawSpring(ctx, sensorX, magYBot - 4, sensorX, sensorY + 35, 5, 5);
  }
  
  // 感光元件電路基板
  ctx.fillStyle = '#064e3b';
  ctx.fillRect(sensorX - 3.5, sensorY - 35, 7, 70);
  
  // 矽光電感應區
  ctx.fillStyle = '#1d4ed8';
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  if (state.oisMode === 'sensor' && Math.abs(state.sensorShift) > 0.5) {
    ctx.shadowColor = '#3b82f6';
    ctx.shadowBlur = 8;
  }
  ctx.fillRect(sensorX - 1.5, sensorY - 26, 3, 52);
  ctx.strokeRect(sensorX - 1.5, sensorY - 26, 3, 52);
  ctx.shadowBlur = 0;
  
  // G. 光路折射與對焦模擬 (光 - 射入光線與修正)
  const rayAngle = -state.theta;
  const hitLocalY = state.lensShift + state.focalLength * Math.tan(rayAngle);
  const deviation = hitLocalY - state.sensorShift;
  const isStabilized = Math.abs(deviation) < 3.0;
  
  // 繪製三道平行入射光束 (簡報原理介紹圖b)
  const offsets = [-15, 0, 15];
  ctx.lineWidth = 2;
  
  offsets.forEach(offset => {
    // 1. 光線前進到一般前透鏡 (X = -65)
    const yAtLens1 = offset - state.shakeOffset.y - (-65) * state.theta;
    
    // 2. 到達可動防震鏡片 (X = -40)
    const yAtOisLens = offset - state.shakeOffset.y - (-40) * state.theta;
    
    // 3. 到達後透鏡組 (X = -15)
    // 根據 OIS 鏡片偏移，光線會產生偏折。如果已補償，光點會被折射回中心
    const yAtLens2 = yAtOisLens + (15 / 110) * (hitLocalY - yAtOisLens);
    
    ctx.strokeStyle = isStabilized ? 'rgba(0, 255, 102, 0.65)' : 'rgba(0, 240, 255, 0.65)';
    ctx.shadowColor = isStabilized ? '#00ff66' : '#00f0ff';
    ctx.shadowBlur = isStabilized ? 4 : 1;
    
    ctx.beginPath();
    ctx.moveTo(-180, offset - state.shakeOffset.y - (-180) * state.theta); // 機身外
    ctx.lineTo(-65, yAtLens1); // 一般前透鏡
    ctx.lineTo(lensX, yAtOisLens); // OIS 鏡片
    ctx.lineTo(-15, yAtLens2); // 一般後透鏡
    ctx.lineTo(sensorX, hitLocalY); // 感光元件焦點
    ctx.stroke();
  });
  ctx.shadowBlur = 0;
  
  // 繪製焦點 (Focus Spot)
  ctx.fillStyle = isStabilized ? '#00ff66' : '#ff3366';
  ctx.shadowColor = isStabilized ? '#00ff66' : '#ff3366';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(sensorX, hitLocalY, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  
  // H. 繪製光機電元件文字標記線 (中文標註，直接對應簡報文字)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.font = '8px Noto Sans TC, sans-serif';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 0.5;
  
  // 1. 陀螺儀
  ctx.fillText('陀螺儀感測器 (電)', -108, -60);
  
  // 2. MCU
  ctx.fillText('控制晶片 MCU (電)', -108, 62);
  
  // 3. 彈簧片
  ctx.fillText('懸浮彈簧片 (機)', -25, -60);
  ctx.beginPath(); ctx.moveTo(-25, -57); ctx.lineTo(lensX, magYTop + 8); ctx.stroke();
  
  // 4. 音圈馬達線圈
  ctx.fillText('音圈馬達線圈 (電/機)', 2, -49);
  ctx.beginPath(); ctx.moveTo(2, -46); ctx.lineTo(-32, coilYTop); ctx.stroke();
  
  // 5. 補償鏡片
  ctx.fillText('防手震補償鏡片 (光/機)', -35, lensY - 14);
  
  // 6. 一般透鏡組
  ctx.fillText('一般固定透鏡組 (光)', -85, 20);
  ctx.beginPath(); ctx.moveTo(-85, 17); ctx.lineTo(-65, 10); ctx.stroke();
  
  // 7. 感光元件
  ctx.fillText('感光元件平面 (光/電)', 48, sensorY + 44);
  
  ctx.restore(); // 恢復世界空間
  
  // 畫布背景固定提示線
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(30, cy);
  ctx.lineTo(w - 30, cy);
  ctx.stroke();
  ctx.setLineDash([]);
}


// 2. 繪製右側觀景窗 (最終照片)
function drawViewfinder() {
  const canvas = elements.viewfinderCanvas;
  const ctx = ctxs.viewfinder;
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  
  const history = state.viewfinderHistory;
  const steps = history.length;
  if (steps === 0) return;
  
  // 計算晃動產生的模糊程度 (速度快則層數多、透明度低)
  let speed = 0;
  if (steps >= 2) {
    const p1 = history[steps - 1];
    const p2 = history[steps - 2];
    speed = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }
  
  // OIS 關閉時套用運動模糊
  const isOisOff = state.oisMode === 'off';
  const drawLayers = isOisOff ? steps : 1;
  
  for (let i = 0; i < drawLayers; i++) {
    const pos = history[steps - 1 - i];
    if (!pos) continue;
    
    ctx.save();
    // 設定透明度堆疊
    ctx.globalAlpha = isOisOff ? (1.0 - (i / steps)) * (1 / (1 + speed * 0.15)) : 1.0;
    
    // 平移坐標
    ctx.translate(w / 2 - pos.x, h / 2 - pos.y);
    
    // 繪製觀景窗內容
    drawViewfinderContent(ctx);
    ctx.restore();
  }
}

// 繪製觀景窗內的對照靶紙 (幾何簡約景物)
function drawViewfinderContent(ctx) {
  // 漸層背景天空
  const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, 110);
  grad.addColorStop(0, '#1e293b');
  grad.addColorStop(1, '#0f172a');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 100, 0, Math.PI * 2);
  ctx.fill();
  
  // 繪製靶心同心圓
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 55, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 85, 0, Math.PI * 2); ctx.stroke();
  
  // 中心合焦指示環
  const isStabilized = state.oisMode !== 'off' || (Math.abs(state.viewfinderPos.y) < 3.0);
  ctx.strokeStyle = isStabilized ? '#00ff66' : '#ff3366';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.stroke();
  
  // 十字準心
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-95, 0); ctx.lineTo(-15, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(95, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -95); ctx.lineTo(0, -15); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(0, 95); ctx.stroke();
}

// --- 動畫主循環 ---
function loop(currentTime) {
  updatePhysics(currentTime);
  drawPhysical();
  drawViewfinder();
  requestAnimationFrame(loop);
}

// --- 初始化啟動 ---
function init() {
  initInteraction();
  handleResize();
  updateUI();
  requestAnimationFrame(loop);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
