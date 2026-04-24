const MAX_FLOOR = 20;
const LOBBY_FLOOR = 10;
const FLOOR_TRAVEL_MS = 900;

const lobby = document.querySelector('.lobby');
const character = document.getElementById('character');
const characterCanvas = document.getElementById('character-canvas');
const button = document.getElementById('button');
const btnUp = document.getElementById('btn-up');
const btnDown = document.getElementById('btn-down');

const lifts = Array.from(document.querySelectorAll('.lift-wrap')).map((el) => ({
  el,
  frame: el.querySelector('.lift-frame'),
  led: el.querySelector('.lift-led'),
  doors: el.querySelectorAll('.door'),
  currentFloor: randomFloor(),
  direction: 'idle',
  timer: null,
}));

function fitLobby() {
  const scale = Math.min(window.innerWidth / 800, window.innerHeight / 500);
  lobby.style.transform = `translate(-50%, -50%) scale(${scale})`;
}
fitLobby();
window.addEventListener('resize', fitLobby);

// ---------- audio ----------

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
document.addEventListener(
  'click',
  () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
  },
  { once: true }
);

function playDing() {
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1046, now);
  osc.frequency.exponentialRampToValueAtTime(523, now + 0.55);
  gain.gain.setValueAtTime(0.28, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 1.05);
}

// ---------- Rive character ----------

let riveChar = null;
let riveLoaded = false;
try {
  riveChar = new rive.Rive({
    src: 'character.riv',
    canvas: characterCanvas,
    autoplay: false,
    onLoad: () => {
      riveChar.resizeDrawingSurfaceToCanvas();
      riveLoaded = true;
      console.log('Rive loaded. Animations:', riveChar.animationNames);
      // Start with whatever the current state needs.
      setAnim(isMovingState(state) ? 'Walk' : 'Idle');
    },
    onLoadError: (err) => console.error('Rive load failed:', err),
  });
} catch (err) {
  console.error('Rive init failed:', err);
}

function isMovingState(s) {
  return s === 'walking_to_button' || s === 'walking_to_lift';
}

function setAnim(name) {
  if (!riveLoaded || !riveChar) return;
  try {
    if (!riveChar.animationNames.includes(name)) return;
    riveChar.stop(riveChar.playingAnimationNames);
    riveChar.play(name);
  } catch (e) {
    console.error('setAnim error:', e);
  }
}

// ---------- lift state + rendering ----------

function randomFloor() {
  return Math.floor(Math.random() * MAX_FLOOR) + 1;
}

function renderLed(lift) {
  const arrow = lift.direction === 'up' ? '▲' : lift.direction === 'down' ? '▼' : ' ';
  lift.led.textContent = `${arrow}${String(lift.currentFloor).padStart(2, '0')}`;
}

lifts.forEach(renderLed);

const floorPlaque = document.getElementById('lobby-floor-plaque');
if (floorPlaque) floorPlaque.textContent = String(LOBBY_FLOOR);

function travelLiftTo(lift, destFloor, onArrive) {
  if (lift.timer) clearInterval(lift.timer);
  if (lift.currentFloor === destFloor) {
    lift.direction = 'idle';
    renderLed(lift);
    if (onArrive) onArrive();
    else checkPendingCall(lift);
    return;
  }
  lift.direction = lift.currentFloor < destFloor ? 'up' : 'down';
  renderLed(lift);
  lift.timer = setInterval(() => {
    if (lift.direction === 'up') lift.currentFloor++;
    else lift.currentFloor--;
    renderLed(lift);
    if (lift.currentFloor === destFloor) {
      clearInterval(lift.timer);
      lift.timer = null;
      lift.direction = 'idle';
      renderLed(lift);
      if (onArrive) onArrive();
      else checkPendingCall(lift);
    }
  }, FLOOR_TRAVEL_MS);
}

// ---------- scheduling algorithms ----------

const ALGORITHMS = {
  nearest: {
    name: 'Nearest idle',
    choose: (idle) =>
      idle.reduce((best, l) =>
        Math.abs(l.currentFloor - LOBBY_FLOOR) <
        Math.abs(best.currentFloor - LOBBY_FLOOR)
          ? l
          : best
      ),
  },
  random: {
    name: 'Random',
    choose: (idle) => idle[Math.floor(Math.random() * idle.length)],
  },
  furthest: {
    name: 'Furthest idle',
    choose: (idle) =>
      idle.reduce((best, l) =>
        Math.abs(l.currentFloor - LOBBY_FLOOR) >
        Math.abs(best.currentFloor - LOBBY_FLOOR)
          ? l
          : best
      ),
  },
};

let currentAlgorithm = localStorage.getItem('algo') || 'nearest';
if (!ALGORITHMS[currentAlgorithm]) currentAlgorithm = 'nearest';

function chooseIdleLift() {
  const idle = lifts.filter((l) => l.direction === 'idle');
  if (idle.length === 0) return null;
  return ALGORITHMS[currentAlgorithm].choose(idle);
}

let pendingCall = false;

function checkPendingCall(lift) {
  if (!pendingCall) return;
  pendingCall = false;
  activeLift = lift;
  console.log('pending call taken by:', lift.el.id);
  travelLiftTo(lift, LOBBY_FLOOR, onLiftArrived);
}

function dispatchLiftAway(lift, direction) {
  const newFloor =
    direction === 'up'
      ? LOBBY_FLOOR + 1 + Math.floor(Math.random() * (MAX_FLOOR - LOBBY_FLOOR))
      : 1 + Math.floor(Math.random() * (LOBBY_FLOOR - 1));
  travelLiftTo(lift, newFloor);
}

function backgroundCall() {
  const candidates = lifts.filter(
    (l) => l !== activeLift && l.direction === 'idle'
  );
  if (candidates.length === 0) return;
  const lift = candidates[Math.floor(Math.random() * candidates.length)];
  let newFloor;
  do {
    newFloor = randomFloor();
  } while (newFloor === lift.currentFloor);
  console.log('bg call:', lift.el.id, lift.currentFloor, '→', newFloor);
  travelLiftTo(lift, newFloor);
}

function scheduleBgCall() {
  const delay = 4000 + Math.random() * 5000;
  setTimeout(() => {
    if (Math.random() < 0.7) backgroundCall();
    scheduleBgCall();
  }, delay);
}
scheduleBgCall();

// ---------- character interaction state machine ----------
// idle → walking_to_button → at_button → arriving → opening → doors_open →
//   walking_to_lift → entering → invisible → idle

const HOME_X = 20;
const HOME_Y = 180;
const BUTTON_X = 321;
const LEFT_LIFT_X = 189;
const RIGHT_LIFT_X = 449;
// When entering the lift, shift the character's canvas up so its bottom
// aligns with the lift frame bottom (y=389 = lift-y 159 + lift-h 230).
// Canvas bottom = top + 322, so target top = 389 - 322 = 67.
const LIFT_ENTRY_Y = 67;

let state = 'idle';
let activeLift = null;
let requestedDirection = null;
let charCurrentX = HOME_X;
let charCurrentY = HOME_Y;

function setCharPos(targetX, targetY) {
  characterCanvas.classList.toggle('flipped', targetX < charCurrentX);
  character.style.transform = `translate(${targetX - HOME_X}px, ${targetY - HOME_Y}px)`;
  charCurrentX = targetX;
  charCurrentY = targetY;
}

function teleportHome() {
  character.style.transition = 'none';
  character.style.transform = 'translate(0, 0)';
  charCurrentX = HOME_X;
  charCurrentY = HOME_Y;
  void character.offsetWidth;
  character.style.transition = '';
  characterCanvas.classList.remove('flipped');
}

character.addEventListener('click', () => {
  if (editMode) return;
  if (state !== 'idle') return;
  state = 'walking_to_button';
  setCharPos(BUTTON_X, HOME_Y);
  setAnim('Walk');
});

character.addEventListener('transitionend', (e) => {
  // Ignore bubbled transitionend from children (e.g. character-canvas flip).
  if (e.target !== character) return;
  if (e.propertyName !== 'transform') return;
  if (state === 'walking_to_button') {
    state = 'at_button';
    setAnim('Idle');
    pressButton();
  } else if (state === 'walking_to_lift') {
    state = 'entering';
    setAnim('Idle');
    enterLift();
  }
});

lobby.addEventListener('transitionend', (e) => {
  if (e.propertyName !== 'transform') return;
  if (!e.target.classList.contains('door')) return;
  if (!activeLift || !activeLift.frame.contains(e.target)) return;
  if (state === 'opening') {
    state = 'doors_open';
    setTimeout(walkIntoLift, 500);
  } else if (state === 'entering') {
    state = 'invisible';
    // Dispatch the lift away to its next random floor in the chosen direction.
    const lift = activeLift;
    const dir = requestedDirection;
    activeLift = null;
    requestedDirection = null;
    dispatchLiftAway(lift, dir);
    // Wait 1.5s with character invisible, then teleport + fade in.
    setTimeout(teleportAndReset, 1500);
  }
});

function pressButton() {
  button.classList.add('awaiting');
}

btnUp.addEventListener('click', () => chooseDirection('up'));
btnDown.addEventListener('click', () => chooseDirection('down'));

function chooseDirection(dir) {
  if (state !== 'at_button') return;
  requestedDirection = dir;
  button.classList.remove('awaiting');
  const arrow = dir === 'up' ? btnUp : btnDown;
  arrow.classList.add('pressed');
  console.log('user picked:', dir);
  setTimeout(() => {
    arrow.classList.remove('pressed');
    state = 'arriving';
    summonLift();
  }, 400);
}

function summonLift() {
  const chosen = chooseIdleLift();
  if (chosen) {
    activeLift = chosen;
    console.log(
      'scheduler (' + ALGORITHMS[currentAlgorithm].name + ') picked:',
      chosen.el.id,
      'at floor',
      chosen.currentFloor
    );
    travelLiftTo(chosen, LOBBY_FLOOR, onLiftArrived);
  } else {
    pendingCall = true;
    console.log('no idle lift — call queued, waiting for one to free up');
  }
}

function onLiftArrived() {
  activeLift.frame.classList.add('flash');
  playDing();
  setTimeout(() => {
    activeLift.frame.classList.remove('flash');
    state = 'opening';
    activeLift.doors.forEach((d) => d.classList.add('open'));
  }, 400);
}

function walkIntoLift() {
  state = 'walking_to_lift';
  const targetX = activeLift.el.id === 'lift-left' ? LEFT_LIFT_X : RIGHT_LIFT_X;
  // Shift character up so the full body fits inside the lift frame.
  setCharPos(targetX, LIFT_ENTRY_Y);
  setAnim('Walk');
}

function enterLift() {
  // Character is at the lift. Start fade-out + close doors in parallel.
  character.classList.add('fading');
  activeLift.doors.forEach((d) => d.classList.remove('open'));
}

function teleportAndReset() {
  teleportHome();
  requestAnimationFrame(() => {
    character.classList.remove('fading');
  });
  setAnim('Idle');
  state = 'idle';
  console.log('ready for next click');
}

// ---------- settings panel ----------

const settingsIcon = document.getElementById('settings-icon');
const settingsPanel = document.getElementById('settings-panel');

settingsIcon.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPanel.hidden = !settingsPanel.hidden;
});

document.addEventListener('click', (e) => {
  if (
    !settingsPanel.hidden &&
    !settingsPanel.contains(e.target) &&
    !settingsIcon.contains(e.target)
  ) {
    settingsPanel.hidden = true;
  }
});

const savedRadio = document.querySelector(
  `input[name="algo"][value="${currentAlgorithm}"]`
);
if (savedRadio) savedRadio.checked = true;

document.querySelectorAll('input[name="algo"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    if (radio.checked && ALGORITHMS[radio.value]) {
      currentAlgorithm = radio.value;
      localStorage.setItem('algo', radio.value);
      console.log('algorithm switched to:', ALGORITHMS[radio.value].name);
    }
  });
});

// ---------- edit mode (dev only, toggled with 'E' key) ----------

const editCopyBtn = document.getElementById('edit-copy');
const editOverlay = document.getElementById('edit-overlay');
const draggables = [
  ...lifts.map((l) => l.el),
  button,
  character,
  document.getElementById('lobby-floor-plaque'),
];

let editMode = false;
let dragging = null;
let resizing = null;
let dragOffset = { x: 0, y: 0 };
let resizeStart = null;

function getVirtualPos(clientX, clientY) {
  const rect = lobby.getBoundingClientRect();
  const scale = rect.width / 800;
  return {
    x: (clientX - rect.left) / scale,
    y: (clientY - rect.top) / scale,
  };
}

function getDisplayPos(el) {
  const s = getComputedStyle(el);
  let left = Math.round(parseFloat(s.left));
  let top = Math.round(parseFloat(s.top));
  let w = Math.round(parseFloat(s.width));
  let h = Math.round(parseFloat(s.height));
  if (el.classList.contains('lift-wrap')) {
    const frame = el.querySelector('.lift-frame');
    top += frame.offsetTop;
    const fs = getComputedStyle(frame);
    w = Math.round(parseFloat(fs.width));
    h = Math.round(parseFloat(fs.height));
  }
  return { left, top, w, h };
}

function setEditMode(on) {
  editMode = on;
  document.body.classList.toggle('edit-mode', on);
  editCopyBtn.hidden = !on;
  editOverlay.hidden = !on;
  if (on) updateOverlay();
}

function updateOverlay(suffix = '') {
  const lines = draggables.map((el) => {
    const { left, top, w, h } = getDisplayPos(el);
    const label = el.id || el.className.split(' ')[0];
    return `${label.padEnd(12, ' ')} left=${left}  top=${top}  w=${w}  h=${h}`;
  });
  editOverlay.textContent = [
    'EDIT MODE — drag to move, shift+drag to resize',
    'lift top = door top (LED moves with it)',
    'keys: E = toggle, C = copy',
    '',
    ...lines,
    suffix,
  ].join('\n');
}

editCopyBtn.addEventListener('click', copyCoords);

function copyCoords() {
  const text = draggables
    .map((el) => {
      const { left, top, w, h } = getDisplayPos(el);
      const label = el.id || el.className.split(' ')[0];
      return `${label}: left=${left}px, top=${top}px, w=${w}px, h=${h}px`;
    })
    .join('\n');
  navigator.clipboard.writeText(text).then(
    () => updateOverlay('\n→ copied to clipboard!'),
    () => updateOverlay('\n(clipboard blocked — see console)')
  );
  console.log('positions:\n' + text);
}

draggables.forEach((el) => {
  el.addEventListener('mousedown', (e) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const mouse = getVirtualPos(e.clientX, e.clientY);
    const s = getComputedStyle(el);
    if (e.shiftKey) {
      resizing = el;
      resizeStart = {
        mouseX: mouse.x,
        mouseY: mouse.y,
        w: parseFloat(s.width),
        h: parseFloat(s.height),
      };
    } else {
      dragging = el;
      dragOffset = {
        x: mouse.x - parseFloat(s.left),
        y: mouse.y - parseFloat(s.top),
      };
    }
  });
});

document.addEventListener('mousemove', (e) => {
  if (!dragging && !resizing) return;
  const mouse = getVirtualPos(e.clientX, e.clientY);
  if (dragging) {
    dragging.style.left = `${Math.round(mouse.x - dragOffset.x)}px`;
    dragging.style.top = `${Math.round(mouse.y - dragOffset.y)}px`;
  } else if (resizing) {
    const newW = Math.max(12, resizeStart.w + (mouse.x - resizeStart.mouseX));
    const newH = Math.max(12, resizeStart.h + (mouse.y - resizeStart.mouseY));
    resizing.style.width = `${Math.round(newW)}px`;
    resizing.style.height = `${Math.round(newH)}px`;
  }
  updateOverlay();
});

document.addEventListener('mouseup', () => {
  dragging = null;
  resizing = null;
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'e' || e.key === 'E') setEditMode(!editMode);
  else if ((e.key === 'c' || e.key === 'C') && editMode) copyCoords();
});
