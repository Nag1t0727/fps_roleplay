import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createState,step,MAP,WIDTH,HEIGHT,EXIT,HAZARDS,canStand,isWall,raycast,sanitizeInput,addSignal,blankInput,ROUND_SECONDS,ROUND_BREAK,MAX_PITCH,normalizeAngle} from '../src/engine.js';
import {Room} from '../src/network.js';
import {visibleEntities} from '../src/renderer.js';
import {humanoidPose} from '../src/humanoid.js';

test('map is enclosed and every core, exit and spawn is reachable without crossing a wall',()=>{
  assert.ok(MAP.every(row=>row.length===WIDTH));
  const state=createState(),visited=new Set(),queue=[[2,13]];
  while(queue.length){const [x,y]=queue.shift(),key=`${x},${y}`;if(visited.has(key)||isWall(x,y))continue;visited.add(key);queue.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}
  for(const p of [...state.teams,...state.cores,...state.enemies,EXIT]){
    assert.ok(canStand(p.x,p.y),JSON.stringify(p));assert.ok(visited.has(`${Math.floor(p.x)},${Math.floor(p.y)}`));
  }
  assert.ok(HAZARDS.every(p=>!isWall(p.x,p.y)));
  assert.equal(MAP[0],'1'.repeat(WIDTH));assert.equal(MAP[HEIGHT-1],'1'.repeat(WIDTH));
});
test('only lower body moves and only upper body can aim or shoot',()=>{
  const state=createState(true),t=state.teams[0],x=t.x,y=t.y,a=t.angle;
  step(state,{'a-upper':{forward:1,strafe:1},'a-lower':{turn:1,look:.3,fire:true}},.05);
  assert.equal(t.x,x);assert.equal(t.y,y);assert.equal(t.angle,a);assert.equal(state.shots.length,0);
  step(state,{'a-lower':{forward:1},'a-upper':{turn:1,fire:true}},.05);
  assert.ok(t.y<y);assert.ok(t.angle>a);assert.equal(state.shots.length,1);
});
test('collision stops a body at walls and diagonal movement has the same speed',()=>{
  const state=createState(true),t=state.teams[0];t.x=1.23;t.y=12;t.bodyAngle=Math.PI;
  for(let i=0;i<120;i++)step(state,{'a-lower':{forward:1}},1/60);
  assert.ok(t.x>=1.22);
  const straight=createState(true),diagonal=createState(true);
  step(straight,{'a-lower':{forward:1}},.05);step(diagonal,{'a-lower':{forward:1,strafe:1}},.05);
  const dist=s=>Math.hypot(s.teams[0].x-2.5,s.teams[0].y-13.2);
  assert.ok(Math.abs(dist(straight)-dist(diagonal))<1e-8);
});
test('shots hit an invisible enemy in front but never through a wall',()=>{
  const state=createState(true),t=state.teams[0];t.x=2.5;t.y=12.5;t.angle=0;
  state.enemies=[{id:0,x:4,y:12.5,hp:2,hit:0}];step(state,{'a-upper':{fire:true}},.01);
  assert.equal(state.enemies[0].hp,1);
  t.x=3;t.y=11.5;t.angle=0;t.cooldown=0;state.enemies[0].x=8;state.enemies[0].y=11.5;
  step(state,{'a-upper':{fire:true}},.01);assert.equal(state.enemies[0].hp,1);
  assert.ok(raycast(t.x,t.y,t.angle).distance<2);
});
test('practice cores are collected once and reaching the exit completes training',()=>{
  const state=createState(true),t=state.teams[0];state.enemies=[];
  for(const core of state.cores){t.x=core.x;t.y=core.y;step(state,{},.01);step(state,{},.01);}
  assert.equal(state.collected,4);t.x=EXIT.x;t.y=EXIT.y;step(state,{},.01);assert.equal(state.status,'won');
  const time=state.time;step(state,{},.05);assert.equal(state.time,time);
});
test('solo extraction requires only one body',()=>{
  const state=createState(true);state.collected=4;state.teams[0].x=EXIT.x;state.teams[0].y=EXIT.y;
  step(state,{},.01);assert.equal(state.status,'won');
});
test('practice hazards damage and a downed player ends the mission',()=>{
  const state=createState(true);state.enemies=[];const [a]=state.teams;
  a.x=6.5;a.y=4.5;step(state,{},.05);assert.ok(a.hp<100);
  a.hp=0;step(state,{},.01);assert.equal(state.status,'lost');
});
test('untrusted input cannot create NaN or unbounded movement',()=>{
  assert.deepEqual(sanitizeInput(null),blankInput());
  assert.deepEqual(sanitizeInput({forward:Infinity,strafe:-100,turn:NaN,look:999,pitchLook:-999,pitchTurn:Infinity,bodyTurn:NaN,fire:'yes'}),{...blankInput(),strafe:-1,look:.35,pitchLook:-.35});
  const state=createState(true);step(state,{'a-lower':{forward:Infinity}},999);
  assert.ok(Number.isFinite(state.teams[0].x));assert.equal(state.time,359.95);
});
test('signals are restricted to a team, replaced and expire',()=>{
  const state=createState();addSignal(state,'a-lower',0);addSignal(state,'a-upper',1);addSignal(state,'b-lower',1);addSignal(state,'bogus',0);
  assert.equal(state.signals.length,2);assert.equal(state.signals[0].from,'上半身');
  for(let i=0;i<61;i++)step(state,{},.05);assert.equal(state.signals.length,0);
});
test('host consumes mouse delta once and discards stale remote controls',()=>{
  const room=new Room();room.inputs['a-upper']={...blankInput(),look:.2,pitchLook:.15,fire:true};room.lastInput['a-upper']=performance.now();
  const first=room.readInputs()['a-upper'],second=room.readInputs()['a-upper'];
  assert.equal(first.look,.2);assert.equal(second.look,0);assert.equal(first.pitchLook,.15);assert.equal(second.pitchLook,0);
  room.lastInput['a-upper']=performance.now()-500;assert.deepEqual(room.readInputs(),{});
});
test('occupied seats cannot be claimed and switching clears previous input',()=>{
  const room=new Room();room.id='host';room.slot='a-lower';room.players=[{id:'host',slot:'a-lower'},{id:'guest',slot:'a-upper'}];
  room.inputs['a-lower']={forward:1};room.claimFor('host','a-upper');assert.equal(room.slot,'a-lower');
  room.claimFor('host','b-upper');assert.equal(room.slot,'b-upper');assert.equal(room.inputs['a-lower'],undefined);
});

const advanceRound=state=>{for(let i=0;i<ROUND_BREAK*20&&state.status==='round-over';i++)step(state,{'a-lower':{forward:1},'a-upper':{fire:true}},.05);};
const faceOff=state=>{
  Object.assign(state.teams[0],{x:2.5,y:12.5,angle:0});
  Object.assign(state.teams[1],{x:4,y:12.5,angle:Math.PI});
};
test('duel uses opposite spawns, no drones, and hides opponent and pickups from upper body',()=>{
  const state=createState();assert.equal(state.mode,'duel');assert.equal(state.time,90);assert.equal(state.enemies.length,0);
  assert.ok(Math.hypot(state.teams[0].x-state.teams[1].x,state.teams[0].y-state.teams[1].y)>10);
  for(const id of ['a','b']){
    assert.deepEqual(visibleEntities(state,`${id}-upper`),[]);
    const visible=visibleEntities(state,`${id}-lower`);
    assert.equal(visible.filter(e=>e.type==='opponent').length,1);
    assert.notEqual(visible.find(e=>e.type==='opponent').id,id);
    assert.equal(visible.filter(e=>e.type==='core').length,4);
  }
});
test('PvP shots deal 25 damage, respect cooldown, and cannot go through walls',()=>{
  const state=createState();faceOff(state);const [a,b]=state.teams;
  step(state,{'a-upper':{fire:true}},.01);assert.equal(b.hp,75);assert.equal(a.hp,100);
  step(state,{'a-upper':{fire:true}},.01);assert.equal(b.hp,75);
  Object.assign(a,{x:3,y:11.5,angle:0,cooldown:0});Object.assign(b,{x:8,y:11.5});
  step(state,{'a-upper':{fire:true}},.01);assert.equal(b.hp,75);
});
test('four hits win a round and freeze movement and damage until a clean side-swapped restart',()=>{
  const state=createState();faceOff(state);const [a,b]=state.teams;
  for(let i=0;i<4;i++){a.cooldown=0;step(state,{'a-upper':{fire:true}},.01);}
  assert.equal(b.hp,0);assert.equal(state.status,'round-over');assert.equal(state.scores.a,1);assert.equal(state.round,1);
  const x=a.x,y=a.y;state.cores[0].taken=true;
  step(state,{'a-lower':{forward:1},'a-upper':{fire:true}},.05);
  assert.equal(a.x,x);assert.equal(a.y,y);assert.equal(b.hp,0);
  advanceRound(state);
  assert.equal(state.round,2);assert.equal(state.status,'playing');assert.equal(state.scores.a,1);
  assert.equal(a.hp,100);assert.equal(b.hp,100);assert.equal(a.x,17.5);assert.equal(b.x,2.5);
  assert.ok(state.cores.every(c=>!c.taken));assert.equal(state.shots.length,0);assert.equal(state.time,ROUND_SECONDS);
  assert.equal(a.bodyAngle,a.angle);assert.equal(a.pitch,0);assert.equal(a.gait,0);assert.equal(a.moveSpeed,0);
});
test('both lethal shots in the same tick result in a draw rather than an A-team advantage',()=>{
  const state=createState();faceOff(state);state.teams.forEach(t=>{t.hp=25;});
  step(state,{'a-upper':{fire:true},'b-upper':{fire:true}},.01);
  assert.ok(state.teams.every(t=>t.hp===0));assert.equal(state.roundWinner,null);assert.equal(state.status,'round-over');
  assert.deepEqual(state.scores,{a:0,b:0});
});
test('timeout compares displayed HP and equal HP is a draw',()=>{
  const state=createState();state.time=.01;state.teams[1].hp=80;
  step(state,{},.01);assert.equal(state.roundWinner,'a');assert.match(state.reason,/時間切れ/);
  const tied=createState();tied.time=.01;tied.teams[0].hp=99.1;tied.teams[1].hp=99.8;
  step(tied,{},.01);assert.equal(tied.roundWinner,null);assert.deepEqual(tied.scores,{a:0,b:0});
});
test('all three rounds are played even at 2-0, then the final winner is frozen',()=>{
  const state=createState();
  for(let round=1;round<=3;round++){
    assert.equal(state.round,round);state.teams[1].hp=0;step(state,{},.01);
    if(round<3){assert.equal(state.status,'round-over');advanceRound(state);}
  }
  assert.equal(state.status,'finished');assert.equal(state.winner,'a');assert.equal(state.rounds.length,3);
  assert.deepEqual(state.scores,{a:3,b:0});
  const snapshot=JSON.stringify(state);step(state,{'a-upper':{fire:true}},.05);assert.equal(JSON.stringify(state),snapshot);
  const rematch=createState();assert.equal(rematch.round,1);assert.deepEqual(rematch.scores,{a:0,b:0});
});
test('three timeout draws produce a tied match',()=>{
  const state=createState();
  for(let i=0;i<3;i++){state.time=.01;step(state,{},.01);if(i<2)advanceRound(state);}
  assert.equal(state.status,'finished');assert.equal(state.winner,null);assert.equal(state.rounds.length,3);
});
test('repair cores heal up to 100 once per round; full-health players do not consume them',()=>{
  const state=createState(),a=state.teams[0],core=state.cores[0];a.x=core.x;a.y=core.y;
  step(state,{},.01);assert.equal(core.taken,false);
  a.hp=85;step(state,{},.01);assert.equal(a.hp,100);assert.equal(core.taken,true);
  a.hp=50;step(state,{},.01);assert.equal(a.hp,50);
});

test('changing the view cannot steer a held W away from a hazard',()=>{
  const straight=createState(true),looking=createState(true);
  for(const state of [straight,looking])Object.assign(state.teams[0],{x:6.5,y:5.05,bodyAngle:-Math.PI/2});
  for(let i=0;i<5;i++){
    step(straight,{'a-lower':{forward:1}},.05);
    step(looking,{'a-lower':{forward:1},'a-upper':{turn:1,look:.35,pitchTurn:1,bodyTurn:1}},.05);
  }
  const a=straight.teams[0],b=looking.teams[0];
  assert.equal(a.x,b.x);assert.equal(a.y,b.y);assert.equal(a.hp,b.hp);assert.ok(b.hp<100);
  assert.equal(a.bodyAngle,b.bodyAngle);assert.notEqual(a.angle,b.angle);
});
test('lower-body steering changes W direction without turning the shared camera',()=>{
  const state=createState(true),team=state.teams[0],view=team.angle;
  for(let i=0;i<10;i++)step(state,{'a-lower':{bodyTurn:1,turn:1,pitchTurn:1,look:.3}},.05);
  assert.equal(team.angle,view);assert.equal(team.pitch,0);assert.notEqual(team.bodyAngle,view);
  const x=team.x,y=team.y;step(state,{'a-lower':{forward:1}},.05);
  assert.ok(team.x>x);assert.ok(team.y<y);
});
test('neck can spin through a full circle while pitch is bounded and body heading stays fixed',()=>{
  const state=createState(true),team=state.teams[0],start=team.angle;
  for(let i=0;i<80;i++)step(state,{'a-upper':{turn:1,pitchTurn:1}},.05);
  assert.ok(Math.abs(normalizeAngle(team.angle-start-8.2))<1e-8);
  assert.equal(team.bodyAngle,start);assert.equal(team.pitch,MAX_PITCH);
  for(let i=0;i<80;i++)step(state,{'a-upper':{pitchTurn:-1}},.05);
  assert.equal(team.pitch,-MAX_PITCH);
});
test('vertical aiming misses above and below the robot and hits its torso',()=>{
  const state=createState();faceOff(state);const [a,b]=state.teams;
  for(const pitch of [.8,-.8]){a.pitch=pitch;a.cooldown=0;step(state,{'a-upper':{fire:true}},.01);assert.equal(b.hp,100);}
  a.pitch=-.2;a.cooldown=0;step(state,{'a-upper':{fire:true}},.01);assert.equal(b.hp,75);
  assert.equal(state.shots.at(-1).pitch,-.2);
});
test('humanoid legs and arms animate with actual walking and the head rotates independently',()=>{
  const team=createState(true).teams[0],rest=humanoidPose(team);
  team.gait=Math.PI/2;team.moveSpeed=1;const walk=humanoidPose(team);
  assert.notEqual(walk.leftAnkle.y,rest.leftAnkle.y);assert.notEqual(walk.leftHand.y,rest.leftHand.y);
  const hip=walk.leftHip;team.angle+=Math.PI;team.pitch=.5;const turned=humanoidPose(team);
  assert.deepEqual(turned.leftHip,hip);assert.notDeepEqual(turned.look,walk.look);
  assert.ok(turned.rightHand.z>walk.rightHand.z);
});
