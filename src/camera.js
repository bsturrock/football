import { ballPos } from './input.js';
import { QB } from './players.js';
import { camera } from './scene.js';
import { S, ball } from './state.js';
import { clamp } from './util.js';

let snapCam = true, autoMode = null;
// B-081: ?autoplay&cam=side|close frames the play for a screenshot, following the ball; side = from the sideline at the line of scrimmage, wide enough for the DBs and LBs; close = tight behind and beside the ball carrier or QB
export const setAutoCam = m => { autoMode = m === 'side' || m === 'close' ? m : null; snapCam = true; };
// B-090: under &stopon the cams aim at the man whose event fired (main.js hands him over at the hit frame); null = the ball, as before
let autoFocus = null;
export const setAutoFocus = p => { autoFocus = p || null; snapCam = true; };
const AUTO_FOV = {side:46, close:38}, AUTO_K = 6;
function autoCamera(dt){
  if(camera.fov !== AUTO_FOV[autoMode]){ camera.fov = AUTO_FOV[autoMode]; camera.updateProjectionMatrix(); }
  let fx, fy;
  if(ball.state === 'air'){ const b = ballPos(Math.min(ball.t, 1)); fx = b.x; fy = b.y; }
  else if(ball.state === 'held' && ball.holder){ fx = ball.holder.x; fy = ball.holder.y; }
  else { fx = QB.x; fy = S.los; }
  if(autoFocus){ fx = autoFocus.x; fy = autoFocus.y; }
  if(autoMode === 'side'){ fy = Math.max(fy, S.los) + 3; tmpPos.set(fx*0.5 + 15, 3.5, 50 - fy); tmpLook.set(fx*0.5, 1, 50 - fy); }
  else { tmpPos.set(fx + 6, 3.2, 50 - fy + 7); tmpLook.set(fx, 1, 50 - fy - 2); }
  const k = snapCam ? 1 : 1 - Math.exp(-dt*AUTO_K);
  camPos.lerp(tmpPos, k); camLook.lerp(tmpLook, k); snapCam = false;
  camera.position.copy(camPos); camera.lookAt(camLook);
}
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
  if(autoMode){ autoCamera(dt); return; }
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
