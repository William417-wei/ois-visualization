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

// 1. 繪製左側相機內部結構 (對應簡報：光、機、電元件與原理 - 簡約學術向量圖風格)
function drawPhysical() {
  const canvas = elements.physicalCanvas;
  const ctx = ctxs.physical;
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  
  // 乾淨白底背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  
  // 繪製背景細格線 (淺灰色，極淡)
  ctx.strokeStyle = '#f1f5f9';
  ctx.lineWidth = 1;
  const grid = 25;
  for (let x = 0; x < w; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  
  const cx = w / 2;
  const cy = h / 2;
  
  // 畫布中心在手震位置 (x, y)，並配合傾斜角度旋轉與放大
  ctx.save();
  ctx.translate(cx + state.shakeOffset.x, cy + state.shakeOffset.y);
  ctx.rotate(state.theta);
  ctx.scale(1.22, 1.22); // 放大鏡頭模組以清晰展示內部細節
  
  // A. 繪製相機鏡筒外殼 (機 - 鏡筒結構：銀灰色金屬感，無霓虹)
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(-120, -70, 240, 140, 8);
  ctx.fill();
  ctx.stroke();
  
  // 繪製相機中心軸 (Camera Axis - 簡約灰色虛線)
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(-115, 0);
  ctx.lineTo(115, 0);
  ctx.stroke();
  ctx.setLineDash([]);
  
  // B. 電學元件 (電) - 陀螺儀感測器、控制晶片 (MCU)
  // 陀螺儀 (Gyro Sensor - 扁平晶片風格)
  const gyroX = -95, gyroY = -52, gyroW = 35, gyroH = 22;
  ctx.fillStyle = '#f1f5f9';
  ctx.strokeStyle = '#64748b'; 
  ctx.lineWidth = 1.5;
  ctx.fillRect(gyroX, gyroY, gyroW, gyroH);
  ctx.strokeRect(gyroX, gyroY, gyroW, gyroH);
  
  // 抖動時背景變為淡黃色 (向量指示，無發光陰影)
  if (Math.abs(state.theta) > 0.001) {
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(gyroX, gyroY, gyroW, gyroH);
    ctx.strokeRect(gyroX, gyroY, gyroW, gyroH);
  }
  
  ctx.fillStyle = '#334155';
  ctx.font = 'bold 8px -apple-system, sans-serif';
  ctx.fillText('GYRO', gyroX + 5, gyroY + 14);
  
  // 控制晶片 (MCU / Control Chip)
  const mcuX = -95, mcuY = 30, mcuW = 35, mcuH = 22;
  ctx.fillStyle = '#f1f5f9';
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1.5;
  ctx.fillRect(mcuX, mcuY, mcuW, mcuH);
  ctx.strokeRect(mcuX, mcuY, mcuW, mcuH);
  
  ctx.fillStyle = '#334155';
  ctx.fillText('MCU', mcuX + 7, mcuY + 14);
  
  // 繪製電路板金屬導線與電流訊號 (電 - 微控制器與電源)
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  // 導線1：陀螺儀 -> MCU
  ctx.beginPath();
  ctx.moveTo(gyroX + gyroW / 2, gyroY + gyroH);
  ctx.lineTo(mcuX + mcuW / 2, mcuY);
  ctx.stroke();
  
  // 導線2：MCU -> 音圈馬達 (向上/向下分流)
  ctx.beginPath();
  ctx.moveTo(mcuX + mcuW, mcuY + mcuH / 2);
  ctx.lineTo(-45, mcuY + mcuH / 2);
  ctx.lineTo(-45, 36 + state.lensShift);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-45, mcuY + mcuH / 2);
  ctx.lineTo(-45, -36 + state.lensShift);
  ctx.stroke();
  
  // 若 OIS 開啟且手機在抖動，在導線上繪製流動的黃色信號點
  if (state.oisMode !== 'off' && Math.abs(state.shakeOffset.y) > 0.5) {
    ctx.save();
    ctx.strokeStyle = '#d97706'; // 深黃橘色電流，無光暈
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.lineDashOffset = -performance.now() / 15;
    
    // 繪製流動電流
    ctx.beginPath();
    ctx.moveTo(gyroX + gyroW / 2, gyroY + gyroH);
    ctx.lineTo(mcuX + mcuW / 2, mcuY);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(mcuX + mcuW, mcuY + mcuH / 2);
    ctx.lineTo(-45, mcuY + mcuH / 2);
    ctx.lineTo(-45, 36 + state.lensShift);
    ctx.moveTo(-45, mcuY + mcuH / 2);
    ctx.lineTo(-45, -36 + state.lensShift);
    ctx.stroke();
    ctx.restore();
  }
  
  // C. 音圈馬達致動器 (電/機 - 致動器的馬達本體、線圈與磁鐵)
  // 永磁鐵 (Magnets) - 固裝在相機外殼上 (扁平紅白/藍磁極)
  const magYTop = -48, magYBot = 48;
  ctx.fillStyle = '#ef4444'; // N極
  ctx.fillRect(-52, magYTop - 4, 12, 8);
  ctx.fillStyle = '#3b82f6'; // S極
  ctx.fillRect(-40, magYTop - 4, 12, 8);
  
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(-52, magYBot - 4, 12, 8);
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(-40, magYBot - 4, 12, 8);
  
  // 驅動線圈 (Coils) - 包在 OIS 鏡筒兩側，隨鏡片移動 (細緻銅線圈風格)
  const coilYTop = -36 + state.lensShift;
  const coilYBot = 36 + state.lensShift;
  ctx.strokeStyle = '#b45309'; // 扁平銅色
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-49, coilYTop); ctx.lineTo(-31, coilYTop);
  ctx.moveTo(-49, coilYTop - 2.5); ctx.lineTo(-31, coilYTop - 2.5);
  ctx.moveTo(-49, coilYBot); ctx.lineTo(-31, coilYBot);
  ctx.moveTo(-49, coilYBot + 2.5); ctx.lineTo(-31, coilYBot + 2.5);
  ctx.stroke();
  
  // D. 光學元件 (光) - 一般的透鏡組、防手震補償鏡片、感測器平面
  // 1. 一般固定透鏡組 (Fixed Lenses) - 清晰無光暈的淺藍色玻璃
  ctx.fillStyle = 'rgba(37, 99, 235, 0.05)';
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.35)';
  ctx.lineWidth = 1;
  // 前透鏡
  ctx.beginPath(); ctx.ellipse(-65, 0, 4, 28, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  // 後透鏡
  ctx.beginPath(); ctx.ellipse(-15, 0, 4, 28, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  
  // 2. 防手震補償鏡片 (OIS Lens) - 可動，無發光陰影
  const lensX = -40;
  const lensY = state.lensShift;
  
  // 鏡筒可動框架 (機 - 鏡筒結構：簡約金屬灰框)
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#64748b'; 
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(lensX - 6, lensY - 26, 12, 52, 2);
  ctx.fill();
  ctx.stroke();
  
  // OIS 玻璃鏡片 (光 - 藍色玻璃面)
  ctx.fillStyle = 'rgba(37, 99, 235, 0.15)';
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(lensX, lensY, 4.5, 20, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();
  
  // E. 機械懸浮結構 (機 - 懸浮與支撐結構 / 彈簧片)
  // 用波浪線繪製彈簧片 (Spring)
  drawSpring(ctx, lensX, magYTop + 4, lensX, lensY - 26, 5, 5);
  drawSpring(ctx, lensX, magYBot - 4, lensX, lensY + 26, 5, 5);
  
  // F. 感光元件 (光/電 - 感測器平面)
  const sensorX = 70;
  const sensorY = state.sensorShift;
  
  // 如果是感測器防震 (Sensor-Shift)，感測器也有懸浮彈簧
  if (state.oisMode === 'sensor') {
    drawSpring(ctx, sensorX, magYTop + 4, sensorX, sensorY - 35, 5, 4);
    drawSpring(ctx, sensorX, magYBot - 4, sensorX, sensorY + 35, 5, 4);
  }
  
  // 感光元件電路基板
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(sensorX - 3, sensorY - 35, 6, 70);
  
  // 矽感應平面 (深綠色/深藍色)
  ctx.fillStyle = '#1e3a8a';
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1.5;
  ctx.fillRect(sensorX - 1, sensorY - 26, 2, 52);
  ctx.strokeRect(sensorX - 1, sensorY - 26, 2, 52);
  
  // G. 光路折射與對焦模擬 (光 - 射入光線與修正，無發光陰影)
  const rayAngle = -state.theta;
  const hitLocalY = state.lensShift + state.focalLength * Math.tan(rayAngle);
  const deviation = hitLocalY - state.sensorShift;
  const isStabilized = Math.abs(deviation) < 3.0;
  
  // 繪製三道平行入射光束
  const offsets = [-15, 0, 15];
  ctx.lineWidth = 1.8;
  
  offsets.forEach(offset => {
    // 1. 光線前進到一般前透鏡 (X = -65)
    const yAtLens1 = offset - state.shakeOffset.y - (-65) * state.theta;
    // 2. 到達可動防震鏡片 (X = -40)
    const yAtOisLens = offset - state.shakeOffset.y - (-40) * state.theta;
    // 3. 到達後透鏡組 (X = -15)
    const yAtLens2 = yAtOisLens + (15 / 110) * (hitLocalY - yAtOisLens);
    
    // 合焦綠色，偏離紅色，純色無光暈
    ctx.strokeStyle = isStabilized ? 'rgba(22, 163, 74, 0.75)' : 'rgba(220, 38, 38, 0.75)';
    
    ctx.beginPath();
    ctx.moveTo(-180, offset - state.shakeOffset.y - (-180) * state.theta); 
    ctx.lineTo(-65, yAtLens1); 
    ctx.lineTo(lensX, yAtOisLens); 
    ctx.lineTo(-15, yAtLens2); 
    ctx.lineTo(sensorX, hitLocalY); 
    ctx.stroke();
  });
  
  // 繪製焦點 (Focus Spot - 實心無光暈)
  ctx.fillStyle = isStabilized ? '#16a34a' : '#dc2626';
  ctx.beginPath();
  ctx.arc(sensorX, hitLocalY, 4, 0, Math.PI * 2);
  ctx.fill();
  
  // H. 繪製光機電元件文字標記線 (簡約深灰色，不搶焦點)
  ctx.fillStyle = '#64748b';
  ctx.font = '8px -apple-system, sans-serif';
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 0.8;
  
  // 1. 陀螺儀
  ctx.fillText('陀螺儀感測器 (電)', -108, -60);
  
  // 2. MCU
  ctx.fillText('控制晶片 MCU (電)', -108, 62);
  
  // 3. 彈簧片
  ctx.fillText('懸浮彈簧片 (機)', -25, -60);
  ctx.beginPath(); ctx.moveTo(-25, -57); ctx.lineTo(lensX - 2, magYTop + 8); ctx.stroke();
  
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
  
  // 畫布背景固定中央對齊線 (淺灰虛線)
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(20, cy);
  ctx.lineTo(w - 20, cy);
  ctx.stroke();
  ctx.setLineDash([]);
}

// 2. 繪製右側觀景窗 (最終照片 - 亮色靶紙風格)
function drawViewfinder() {
  const canvas = elements.viewfinderCanvas;
  const ctx = ctxs.viewfinder;
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  
  // 純白景物背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  
  const history = state.viewfinderHistory;
  const steps = history.length;
  if (steps === 0) return;
  
  // 計算晃動速度以確定運動模糊透明度
  let speed = 0;
  if (steps >= 2) {
    const p1 = history[steps - 1];
    const p2 = history[steps - 2];
    speed = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }
  
  // OIS 關閉時套用運動模糊 (疊加多層淺色殘影)
  const isOisOff = state.oisMode === 'off';
  const drawLayers = isOisOff ? steps : 1;
  
  for (let i = 0; i < drawLayers; i++) {
    const pos = history[steps - 1 - i];
    if (!pos) continue;
    
    ctx.save();
    // 運動模糊的透明度分佈
    ctx.globalAlpha = isOisOff ? (1.0 - (i / steps)) * (1 / (1 + speed * 0.12)) : 1.0;
    
    // 平移觀景窗景物
    ctx.translate(w / 2 - pos.x, h / 2 - pos.y);
    
    // 繪製觀景窗內容
    drawViewfinderContent(ctx);
    ctx.restore();
  }
}

// 繪製觀景窗內的景象 (學術簡約、高清晰的相機景物模擬)
function drawViewfinderContent(ctx) {
  // 圓形遮罩背景 (淺藍天空到淺灰漸層)
  const grad = ctx.createLinearGradient(0, -90, 0, 90);
  grad.addColorStop(0, '#bae6fd'); // 淺天空藍
  grad.addColorStop(1, '#f8fafc'); // 地平線白色
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 100, 0, Math.PI * 2);
  ctx.fill();
  
  // 繪製遠方的太陽 (淡黃色)
  ctx.fillStyle = '#fef08a';
  ctx.beginPath();
  ctx.arc(45, -35, 12, 0, Math.PI * 2);
  ctx.fill();
  
  // 繪製遠山 (後排：淺灰色山脈)
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(-80, 45);
  ctx.lineTo(-25, -15);
  ctx.lineTo(30, 45);
  ctx.fill();
  
  // 繪製遠山 (前排較大：石板灰山脈)
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  ctx.moveTo(-50, 60);
  ctx.lineTo(20, -25);
  ctx.lineTo(90, 60);
  ctx.fill();

  // 繪製山丘 (右側：深石板灰山脈)
  ctx.fillStyle = '#64748b';
  ctx.beginPath();
  ctx.moveTo(-15, 60);
  ctx.lineTo(5, 10);
  ctx.lineTo(45, 60);
  ctx.fill();
  
  // 繪製地平線與地面
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.arc(0, 0, 100, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.fill();
  
  // 繪製小針葉樹 (簡約幾何三角形)
  ctx.fillStyle = '#475569';
  // 樹 1
  ctx.beginPath();
  ctx.moveTo(-60, 45);
  ctx.lineTo(-54, 25);
  ctx.lineTo(-48, 45);
  ctx.fill();
  // 樹 2
  ctx.beginPath();
  ctx.moveTo(-45, 50);
  ctx.lineTo(-40, 28);
  ctx.lineTo(-35, 50);
  ctx.fill();
  
  // 中心自動對焦框 (Autofocus Bracket - 模擬真實相機畫面)
  const isStabilized = state.oisMode !== 'off' || (Math.abs(state.viewfinderPos.y) < 3.0);
  ctx.strokeStyle = isStabilized ? '#16a34a' : '#dc2626';
  ctx.lineWidth = 1.8;
  const sz = 12;
  ctx.beginPath();
  // 左上括角
  ctx.moveTo(-sz, -sz + 4); ctx.lineTo(-sz, -sz); ctx.lineTo(-sz + 4, -sz);
  // 右上括角
  ctx.moveTo(sz - 4, -sz); ctx.lineTo(sz, -sz); ctx.lineTo(sz, -sz + 4);
  // 左下括角
  ctx.moveTo(-sz, sz - 4); ctx.lineTo(-sz, sz); ctx.lineTo(-sz + 4, sz);
  // 右下括角
  ctx.moveTo(sz - 4, sz); ctx.lineTo(sz, sz); ctx.lineTo(sz, sz - 4);
  ctx.stroke();
  
  // 對焦中心小點
  ctx.fillStyle = isStabilized ? '#16a34a' : '#dc2626';
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fill();

  // 鏡頭圓形邊框
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 100, 0, Math.PI * 2);
  ctx.stroke();
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
