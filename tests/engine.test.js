import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createState,step,MAP,WIDTH,HEIGHT,EXIT,HAZARDS,canStand,isWall,raycast,sanitizeInput,addSignal,blankInput} from '../src/engine.js';
import {Room} from '../src/network.js';

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
  const state=createState(true),t=state.teams[0];t.x=1.23;t.y=12;t.angle=Math.PI;
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
test('cores are collected once and all active bodies must be at exit to win',()=>{
  const state=createState(),t=state.teams[0];state.enemies=[];
  for(const core of state.cores){t.x=core.x;t.y=core.y;step(state,{},.01);step(state,{},.01);}
  assert.equal(state.collected,4);t.x=EXIT.x;t.y=EXIT.y;step(state,{},.01);assert.equal(state.status,'playing');
  state.teams[1].x=EXIT.x;state.teams[1].y=EXIT.y;step(state,{},.01);assert.equal(state.status,'won');
  const time=state.time;step(state,{},.05);assert.equal(state.time,time);
});
test('solo extraction requires only one body',()=>{
  const state=createState(true);state.collected=4;state.teams[0].x=EXIT.x;state.teams[0].y=EXIT.y;
  step(state,{},.01);assert.equal(state.status,'won');
});
test('hazards damage, surviving teammates revive, and all-down ends mission',()=>{
  const state=createState();state.enemies=[];const [a,b]=state.teams;
  a.x=6.5;a.y=4.5;step(state,{},.05);assert.ok(a.hp<100);
  a.x=2.5;a.y=12.5;a.hp=0;b.x=3.5;b.y=12.5;
  for(let i=0;i<81;i++)step(state,{},.05);assert.equal(a.hp,55);
  a.hp=0;b.hp=0;step(state,{},.01);assert.equal(state.status,'lost');
});
test('untrusted input cannot create NaN or unbounded movement',()=>{
  assert.deepEqual(sanitizeInput(null),blankInput());
  assert.deepEqual(sanitizeInput({forward:Infinity,strafe:-100,turn:NaN,look:999,fire:'yes'}),{forward:0,strafe:-1,turn:0,look:.35,fire:false});
  const state=createState(true);step(state,{'a-lower':{forward:Infinity}},999);
  assert.ok(Number.isFinite(state.teams[0].x));assert.equal(state.time,359.95);
});
test('signals are restricted to a team, replaced and expire',()=>{
  const state=createState();addSignal(state,'a-lower',0);addSignal(state,'a-upper',1);addSignal(state,'b-lower',1);addSignal(state,'bogus',0);
  assert.equal(state.signals.length,2);assert.equal(state.signals[0].from,'上半身');
  for(let i=0;i<61;i++)step(state,{},.05);assert.equal(state.signals.length,0);
});
test('host consumes mouse delta once and discards stale remote controls',()=>{
  const room=new Room();room.inputs['a-upper']={...blankInput(),look:.2,fire:true};room.lastInput['a-upper']=performance.now();
  assert.equal(room.readInputs()['a-upper'].look,.2);assert.equal(room.readInputs()['a-upper'].look,0);
  room.lastInput['a-upper']=performance.now()-500;assert.deepEqual(room.readInputs(),{});
});
test('occupied seats cannot be claimed and switching clears previous input',()=>{
  const room=new Room();room.id='host';room.slot='a-lower';room.players=[{id:'host',slot:'a-lower'},{id:'guest',slot:'a-upper'}];
  room.inputs['a-lower']={forward:1};room.claimFor('host','a-upper');assert.equal(room.slot,'a-lower');
  room.claimFor('host','b-upper');assert.equal(room.slot,'b-upper');assert.equal(room.inputs['a-lower'],undefined);
});
