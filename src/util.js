export const HW = 26.665, MAX_DRIVES = 6, PX = 16;
export const $ = id => document.getElementById(id);
export const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
export const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
export const rand = (a,b) => a + Math.random()*(b-a);
export const sigmoid = x => 1/(1 + Math.exp(-x));
