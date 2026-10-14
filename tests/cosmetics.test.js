import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createState,startEmote,placeSpray,step,ROUND_BREAK} from '../src/engine.js';
import {humanoidPose} from '../src/humanoid.js';

const scene=()=>{const s=createState();Object.assign(s.teams[0],{x:2.5,y:2.5,angle:-Math.PI/2,pitch:0});return s;};
test('both roles can emote; shared cooldown, expiration and shooting arm stay correct',()=>{
  const s=scene(),t=s.teams[0],pose=humanoidPose(t);
  assert.equal(startEmote(s,'a-lower','wave'),true);
  assert.equal(startEmote(s,'a-upper','salute'),false);
  const animated=humanoidPose(t);assert.ok(animated.leftHand.z>pose.leftHand.z);
  assert.deepEqual(animated.muzzle,pose.muzzle);assert.deepEqual(animated.rightHand,pose.rightHand);
  for(let i=0;i<101;i++)step(s,{},.05);
  assert.equal(t.emote,null);assert.equal(startEmote(s,'a-upper','salute'),true);
  t.hp=0;assert.equal(startEmote(s,'a-lower','wave'),false);
  assert.equal(startEmote(s,'forged','wave'),false);assert.equal(startEmote(s,'b-upper','invalid'),false);
});
test('sprays attach to the first wall or floor, refuse sky and far targets, and share cooldown',()=>{
  const s=scene(),t=s.teams[0];
  assert.equal(placeSpray(s,'a-lower','star'),true);
  assert.equal(s.sprays[0].surface,'wall');assert.equal(s.sprays[0].ny,1);assert.ok(Math.abs(s.sprays[0].y-1.012)<.001);
  assert.equal(placeSpray(s,'a-upper','smile'),false);
  t.sprayCooldown=0;t.pitch=-.7;t.angle=0;
  assert.equal(placeSpray(s,'a-upper','smile'),true);assert.equal(s.sprays[1].surface,'floor');assert.equal(s.sprays[1].z,.012);
  t.sprayCooldown=0;t.pitch=1;
  assert.equal(placeSpray(s,'a-lower'),false);
  Object.assign(t,{x:2.5,y:13.2,angle:-Math.PI/2,pitch:0});assert.equal(placeSpray(s,'a-lower'),false);
  assert.equal(t.sprayCooldown,0);assert.equal(placeSpray(s,'a-lower','invalid'),false);assert.equal(placeSpray(s,'forged'),false);
});
test('paint is bounded and round reset clears cosmetics; paused/finished actions are rejected',()=>{
  const s=scene(),t=s.teams[0];
  for(let i=0;i<30;i++){t.sprayCooldown=0;assert.equal(placeSpray(s,'a-upper',i%2?'star':'link'),true);}
  assert.equal(s.sprays.length,24);startEmote(s,'a-upper');
  s.teams[1].hp=0;step(s,{},.01);assert.equal(s.status,'round-over');
  t.sprayCooldown=0;assert.equal(placeSpray(s,'a-upper'),false);assert.equal(startEmote(s,'b-lower'),false);
  for(let i=0;i<(ROUND_BREAK+1)*20;i++)step(s,{},.05);
  assert.equal(s.round,2);assert.equal(s.sprays.length,0);assert.equal(t.emote,null);assert.equal(t.sprayCooldown,0);
});

test('sway alternates the torso sideways with planted feet without moving the player or aim',()=>{
  const s=scene(),t=s.teams[0];t.bodyAngle=0;
  const before={x:t.x,y:t.y,angle:t.angle,pitch:t.pitch},neutral=humanoidPose(t);
  assert.equal(startEmote(s,'a-lower','sway'),true);
  t.emote.life=2.75;const left=humanoidPose(t);
  t.emote.life=2.5;const right=humanoidPose(t);
  assert.ok(left.chest.y>neutral.chest.y);assert.ok(right.chest.y<neutral.chest.y);
  assert.ok(left.head.y>neutral.head.y);assert.ok(right.head.y<neutral.head.y);
  assert.deepEqual(left.leftToe,neutral.leftToe);assert.deepEqual(right.rightToe,neutral.rightToe);
  assert.deepEqual(left.look,neutral.look);assert.deepEqual({x:t.x,y:t.y,angle:t.angle,pitch:t.pitch},before);
  assert.equal(startEmote(s,'a-upper','wave'),false);
  t.emote.life=0;assert.deepEqual(humanoidPose(t).chest,neutral.chest);
});

test('emote camera uses safe third-person positions without mutating body or aim and restores afterward',async()=>{
  const {emoteCamera}=await import('../src/renderer.js');
  const {canStand,raycast}=await import('../src/engine.js');
  for(const position of [[2.5,13.2],[1.23,1.23],[2.5,2.5]])for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2]){
    const s=scene(),t=s.teams[0];Object.assign(t,{x:position[0],y:position[1],angle});
    assert.equal(emoteCamera(t),t);startEmote(s,'a-upper','sway');const before=structuredClone(t),camera=emoteCamera(t);
    assert.notEqual(camera,t);assert.ok(canStand(camera.x,camera.y,.12));
    const d=Math.hypot(camera.x-t.x,camera.y-t.y);
    assert.ok(d>0&&d<=2.6);assert.ok(raycast(t.x,t.y,Math.atan2(camera.y-t.y,camera.x-t.x)).distance>d);
    assert.deepEqual(t,before);t.emote=null;assert.equal(emoteCamera(t),t);
    t.emote={kind:'wave',life:2};t.hp=0;assert.equal(emoteCamera(t),t);
  }
});
