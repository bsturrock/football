import { ballPos } from './input.js';
import { QB } from './players.js';
import { camera } from './scene.js';
import { S, ball } from './state.js';
import { clamp } from './util.js';

let snapCam = true;
export const resetCam = () => { snapCam = true; };
// TV broadcast: high on the home sideline, square to the field, offense moving left to right on screen,
// panning with the ball and leading it a little in the direction it's going
function tvCamera(dt){
  if(camera.fov !== 26){ camera.fov = 26; camera.updateProjectionMatrix(); }
  let fx, fy, lead = 0;
  if(ball.state === 'air'){ const b = ballPos(Math.min(ball.t, 1)); fx = b.x; fy = b.y; }
  else if(ball.state === 'held' && (S.runMode || ball.holder !== QB)){ const c = ball.holder; fx = c.x; fy = c.y; lead = clamp(c.vy*0.5, -2, 3); }
  else { fx = 0; fy = S.los - 2; }
  tmpPos.set(fx*0.3 + 50, 24, 50 - (fy + lead)); tmpLook.set(fx*0.3, 0, 50 - (fy + lead));
  const k = snapCam ? 1 : 1 - Math.exp(-dt*2.5);
  camPos.lerp(tmpPos, k); camLook.lerp(tmpLook, k); snapCam = false;
  camera.position.copy(camPos); camera.lookAt(camLook);
}
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmpPos = new THREE.Vector3(), tmpLook = new THREE.Vector3();
export function updateCamera(dt){
  if(S.cam === 'tv'){ tvCamera(dt); return; }
  if(camera.fov !== 52){ camera.fov = 52; camera.updateProjectionMatrix(); }
  let fx, fy, h, back;
  if(ball.state === 'air'){ const b = ballPos(Math.min(ball.t, 1)); fx = b.x*0.6; fy = b.y; h = 24; back = 22; }
  else if(S.runMode && ball.state === 'held'){ const c = ball.holder; fx = c.x*0.7; fy = c.y + 4; h = 17; back = 17; }
  else { fx = QB.x*0.4; fy = Math.max(QB.y, S.los - 6) + 9; h = 26; back = 24; }
  tmpPos.set(fx, h, 50 - fy + back); tmpLook.set(fx, 0, 50 - fy - 4);
  const k = snapCam ? 1 : 1 - Math.exp(-dt*3);
  camPos.lerp(tmpPos, k); camLook.lerp(tmpLook, k); snapCam = false;
  camera.position.copy(camPos); camera.lookAt(camLook);
}
