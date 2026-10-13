import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { PHASES, startFoot, driveDir, techniqueLabel, PULL_DROP, KICK_LEAN } from '../src/dots/technique.js';

test('pull phase: goal behind the start depth, done once level with the man', () => {
  for (const pull of [-1, 1]) {
    const te = { x: 0, y: 25 };
    const foot = startFoot('pull', 'none', null, te, pull);
    assert.equal(foot.pull, pull);
    assert.equal(foot.phase, 'pull');
    const man = { x: pull * 4, y: 25.3 };
    const env = { target: man, ballPos: { x: 0, y: 25 }, blocker: te };
    const g = PHASES.pull.goal(foot, man, 1, 0.28, env);
    assert.ok(Math.abs(g.y - (25 - PULL_DROP)) < 1e-9);
    assert.ok(g.x * pull > 0 && Math.abs(g.x) < 4, 'inside of the man, on the pull side');
    const denv = { spot: man, radius: 0.28, ...env };
    assert.equal(PHASES.pull.done(foot, { x: 0, y: 24 }, denv), false);
    assert.equal(PHASES.pull.done(foot, { x: pull * 3.8, y: 24 }, denv), true);
    assert.equal(PHASES.pull.done(foot, { x: pull * 5, y: 24 }, denv), true);
    const d = driveDir('pull', 1, pull);
    assert.equal(Math.sign(d.x), pull);
    assert.ok(Math.abs(d.x - pull * Math.sin((KICK_LEAN * Math.PI) / 180)) < 1e-9);
  }
  assert.equal(techniqueLabel('pull', 'none', 'pull'), 'pull');
  assert.equal(techniqueLabel('pull', 'none', 'aim'), 'kick out');
  assert.equal(techniqueLabel('zone', 'head'), 'zone step');
});

for (const teLook of ['backsidePull', 'playsidePull']) {
  for (const playside of ['left', 'right']) {
    test(`${teLook} / ${playside}: TE crosses behind the line, then kicks out`, () => {
      const play = createPlay(25, 'insideZone', { formation: '11', teLook, rbAway: true, playside });
      const los = 25;
      play.snap();
      const te = () => play.players.find((p) => p.id === 'TE');
      const pull = play.pull.side;
      const man = () => play.players.find((p) => p.id === play.plan.blocks.TE);
      let maxY = -Infinity;
      let engagedAt = null;
      let label02 = null;
      let labelEngaged = null;
      const label = () => techniqueLabel(te().block.foot.tech, te().block.foot.shade, te().block.foot.phase);
      for (let i = 0; i < Math.round(3 / FIXED_DT); i++) {
        play.step(FIXED_DT);
        const t = (i + 1) * FIXED_DT;
        const b = te().block;
        if (!b) break;
        if (label02 === null && t >= 0.2 - 1e-9) label02 = label();
        if (b.engaged) {
          if (engagedAt === null) { engagedAt = t; labelEngaged = label(); }
        } else if (b.foot.phase === 'pull' && (man().x - te().x) * pull > 0) maxY = Math.max(maxY, te().y);
      }
      console.log(`${teLook}/${playside}: crossing max y ${(maxY - los).toFixed(2)} past LOS, engaged at ${engagedAt}`);
      assert.ok(maxY < los, 'never past the LOS while crossing');
      assert.ok(engagedAt !== null && engagedAt <= 3, 'engages within 3 s');
      assert.equal(label02, 'pull');
      assert.equal(labelEngaged, 'kick out');
    });
  }
}
