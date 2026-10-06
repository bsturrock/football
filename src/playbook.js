import { cvs } from './scene.js';
import { selectPlay } from './state.js';
import { $ } from './util.js';

export const DEF_CALLS = [
  {name:'Base',             note:'Linemen hold their gaps, linebackers read and fill', slant:0},
  {name:'Slant Left',       note:'Whole line slants one gap to your left', slant:-1.8},
  {name:'Slant Right',      note:'Whole line slants one gap to your right', slant:1.8},
  {name:'Run Blitz',        note:'One linebacker shoots his gap at the snap', slant:0, blitz:true},
  {name:'Eight in the Box', note:'A safety rolls down and the linebackers trigger fast', slant:0, box:true, fastLB:true}
];
// ---------- playbook ----------
// route points: [yards toward the middle, yards downfield from the line]
const PASS_GAME = false;
export const PLAYS = [
  {name:'Slants',        out:{pts:[[0,3],[7,9]], go:true},    slot:{pts:[[0,3],[7,9]], go:true},
                         te:{pts:[[0,10],[0,40]], go:true},   rb:{pts:[[-5,1],[-8,3]], go:false}},
  {name:'Verticals',     out:{pts:[[-2,10],[-2,45]], go:true}, slot:{pts:[[1,10],[2,45]], go:true},
                         te:{pts:[[0,10],[1,45]], go:true},   rb:{pts:[[-4,2],[-3,6]], go:false}},
  {name:'Curl / Out',    out:{pts:[[0,13],[1,11]], go:false},  slot:{pts:[[0,6],[-9,6]], go:true},
                         te:{pts:[[0,6],[1,5]], go:false},    rb:{pts:[[-5,1],[-8,3]], go:false}},
  {name:'Post / Corner', out:{pts:[[0,12],[8,30]], go:true},   slot:{pts:[[0,10],[-9,22]], go:true},
                         te:{pts:[[0,4],[14,6]], go:true},    rb:{pts:[[-6,2],[-8,12],[-8,35]], go:true}},
  // run plays: RB path points are [field x, yards from the line]; hand = handoff, toss = pitch, keep = QB runs
  // scheme 'zone': linemen + TE each own a lane (start x + shift) and block whoever shows up in it, else climb.
  // scheme 'man': `blocks` names each blocker's defender; `pulls` are waypoints [x, yards from line] run first.
  // defender keys: DL0-3 and LB0-1 / S0-1 numbered left to right, CB0-2 = cornerback on WR0-2
  {name:'Inside Zone', run:'hand', scheme:'zone', shift:-1, hole:-1.1,
   blocks:{WR0:'CB0', WR1:'CB1', WR2:'CB2'},
   path:[[-0.5,-3.3],[-1.1,1.5],[-1.1,8]]},
  {name:'Power Left', run:'hand', scheme:'man', hole:-3.6,
   blocks:{LT:'LB0', LG:'DL1', C:'DL2', RG:'DL0', RT:'LB1', TE:'DL3', WR0:'CB0', WR1:'CB1', WR2:'CB2'},
   pulls:{RG:[[0.8,-1.8],[-2.6,-1.8]]},
   path:[[-0.3,-3.6],[-2.8,-1.4],[-3.6,0.8],[-3.8,8]]},   // patient: press the line, cut off the kick-out
  {name:'Outside Zone Right', run:'toss', scheme:'zone', shift:3, hole:8.5,   // aim: tight end's outside hip; he reads bounce / cut back
   blocks:{WR0:'CB0', WR1:'CB1', WR2:'S0'},
   path:[[5,-4.5],[8,-1.8],[8.5,2],[8.5,8]]},
  {name:'QB Draw', run:'keep', scheme:'man', hole:0, passSet:0.7,
   blocks:{LT:'DL0', LG:'DL1', RG:'DL2', RT:'DL3', C:'LB0', TE:'LB1', WR0:'CB0', WR1:'CB1', WR2:'CB2'}}
].filter(p => PASS_GAME || p.run);
const playsEl = $('plays');
PLAYS.forEach((p, i) => {
  if(i === 0 || (p.run && !PLAYS[i-1].run)){
    const l = document.createElement('span'); l.className = 'group'; l.textContent = p.run ? 'Run' : 'Pass'; playsEl.appendChild(l);
  }
  const b = document.createElement('button'); b.className = 'play'; b.type = 'button'; b.id = 'play' + i;
  b.innerHTML = `<kbd>${i+1}</kbd>${p.name}`;
  b.addEventListener('click', () => { selectPlay(i); cvs.focus(); });
  playsEl.appendChild(b);
});
