import { camera, toWorld, wrap } from './scene.js';
import { S } from './state.js';
import { $, MAX_DRIVES } from './util.js';

// ---------- HUD ----------
const ord = n => ['1st','2nd','3rd','4th'][n-1] || n+'th';
export const downText = () => `${ord(S.down)} & ${S.los + S.toGo >= 100 ? 'Goal' : S.toGo}`;
export function updateHUD(){
  $('score').textContent = S.score;
  $('down').textContent = downText();
  $('spot').textContent = S.los > 50 ? `OPP ${100-S.los}` : S.los < 50 ? `OWN ${S.los}` : '50';
  $('drive').textContent = `${Math.min(S.drive, MAX_DRIVES)} / ${MAX_DRIVES}`;
  if(S.defCall) $('defcall').textContent = S.defCall.name;
}
export function warn(msg){ const el = $('warn'); el.textContent = msg; el.classList.add('on'); }   // persistent: stays until reload
export function banner(h, p){ $('bannerH').textContent = h; $('bannerP').textContent = p || ''; $('banner').classList.add('on'); }
export function hideBanner(){ $('banner').classList.remove('on'); }
let toastTimer = 0;
export function toast(t){ const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 900); }
// floating callouts that follow a player (line battle moves and results)
const labels = [];
export function callout(p, text, cls=''){
  return;   // floating player callouts are off; flip this line to bring them back
  const el = document.createElement('div'); el.className = 'callout ' + cls; el.textContent = text;
  $('labels').appendChild(el); labels.push({el, p, t:0, ttl:1.1});
}
export function clearCallouts(){ labels.forEach(l => l.el.remove()); labels.length = 0; }
export function updateCallouts(dt){
  const w = wrap.clientWidth, h = wrap.clientHeight;
  for(let i = labels.length - 1; i >= 0; i--){
    const l = labels[i]; l.t += dt;
    if(l.t > l.ttl){ l.el.remove(); labels.splice(i, 1); continue; }
    const v = toWorld(l.p.x, l.p.y, 2.9 + l.t*0.6).project(camera);
    l.el.style.transform = `translate(${(v.x + 1)/2*w}px, ${(1 - v.y)/2*h}px) translate(-50%, -100%)`;
    l.el.style.opacity = String(Math.min(1, (l.ttl - l.t)*3));
  }
}
let lastHint = '';
export function setHint(html){ if(html !== lastHint){ $('hint').innerHTML = html; lastHint = html; } }
// ?debug line: frame ms (smoothed), physics ms of the last step (smoothed), live body count
const DEBUG = new URLSearchParams(location.search).has('debug');
let dbgFrame = 0, dbgPhys = 0, dbgT = 0;
export function debugTick(rawMs, physMs, bodies){
  if(!DEBUG) return;
  dbgFrame += (rawMs - dbgFrame)*0.1; dbgPhys += (physMs - dbgPhys)*0.1;
  if((dbgT += rawMs) < 250) return; dbgT = 0;
  const el = $('dbg'); el.hidden = false;
  el.textContent = `frame ${dbgFrame.toFixed(1)} ms · phys ${dbgPhys.toFixed(1)} ms · bodies ${bodies}`;
}
