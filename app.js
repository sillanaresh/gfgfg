const MAX_FLOOR = 20;
const LOBBY_FLOOR = 10;
const FLOOR_TRAVEL_MS = 900;

const lobby = document.querySelector('.lobby');
const character = document.getElementById('character');
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

// Audio: synthesized ding chime. Browsers require user interaction
// before audio plays, so we resume the context on first click.
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

// Real-elevator rule: a lift that is mid-trip finishes that trip before taking
// a new call. Scheduler only considers idle lifts. If none are idle when a
// call comes in, the call is queued and taken by whichever lift frees up next.
let pendingCall = false;

function chooseIdleLift() {
  const idle = lifts.filter((l) => l.direction === 'idle');
  if (idle.length === 0) return null;
  return idle.reduce((best, l) =>
    Math.abs(l.currentFloor - LOBBY_FLOOR) <
    Math.abs(best.currentFloor - LOBBY_FLOOR)
      ? l
      : best
  );
}

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

// Background traffic: every 4-9s, a ~70% chance an idle non-active lift
// gets called to a new random floor — simulates other users on other floors.
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

// ---------- interaction state machine ----------
// idle → walking → at_button → arriving → opening → open → closing → returning → idle

let state = 'idle';
let activeLift = null;
let requestedDirection = null;

character.addEventListener('click', () => {
  if (editMode) return;
  if (state !== 'idle') return;
  state = 'walking';
  character.classList.add('walking');
});

character.addEventListener('transitionend', (e) => {
  if (e.propertyName !== 'transform') return;
  if (state === 'walking') {
    state = 'at_button';
    pressButton();
  } else if (state === 'returning') {
    state = 'idle';
  }
});

lobby.addEventListener('transitionend', (e) => {
  if (e.propertyName !== 'transform') return;
  if (!e.target.classList.contains('door')) return;
  if (!activeLift || !activeLift.frame.contains(e.target)) return;
  if (state === 'opening') {
    state = 'open';
    setTimeout(closeDoors, 1000);
  } else if (state === 'closing') {
    const lift = activeLift;
    const dir = requestedDirection;
    activeLift = null;
    requestedDirection = null;
    dispatchLiftAway(lift, dir);
    returnCharacter();
  }
});

function pressButton() {
  // Character arrives at button and waits for user to click up or down.
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
      'scheduler picked:',
      chosen.el.id,
      'currently at floor',
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

function closeDoors() {
  state = 'closing';
  activeLift.doors.forEach((d) => d.classList.remove('open'));
}

function returnCharacter() {
  state = 'returning';
  character.classList.remove('walking');
}

// ---------- edit mode: drag-to-position authoring tool ----------

const editToggleBtn = document.getElementById('edit-toggle');
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

function setEditMode(on) {
  editMode = on;
  document.body.classList.toggle('edit-mode', on);
  editToggleBtn.textContent = on ? 'Exit Edit' : 'Edit Layout';
  editCopyBtn.hidden = !on;
  editOverlay.hidden = !on;
  if (on) updateOverlay();
}

function getDisplayPos(el) {
  const s = getComputedStyle(el);
  let left = Math.round(parseFloat(s.left));
  let top = Math.round(parseFloat(s.top));
  let w = Math.round(parseFloat(s.width));
  let h = Math.round(parseFloat(s.height));
  if (el.classList.contains('lift-wrap')) {
    // Report the door's position (not the LED+door wrap's top).
    const frame = el.querySelector('.lift-frame');
    top += frame.offsetTop;
    const fs = getComputedStyle(frame);
    w = Math.round(parseFloat(fs.width));
    h = Math.round(parseFloat(fs.height));
  }
  return { left, top, w, h };
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

editToggleBtn.addEventListener('click', () => setEditMode(!editMode));
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
