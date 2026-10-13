import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createState,step,canStand,isWall,HAZARDS} from '../src/engine.js';
import {visibleEntities,visibleScans} from '../src/renderer.js';

function collect(kind,solo=false){
  const state=createState(solo),team=state.teams[0];
  state.items=[{id:'test',kind,x:team.x,y:team.y,taken:false}];state.enemies=[];
  if(kind==='repair')team.hp=50;
  step(state,{},.01);return {state,team};
}
test('all pickups are accessible, outside hazards, with every requested kind represented',()=>{
  for(const solo of [true,false]){
    const state=createState(solo),visited=new Set(),queue=[[2,13]];
    while(queue.length){const [x,y]=queue.shift(),key=`${x},${y}`;if(visited.has(key)||isWall(x+.5,y+.5))continue;visited.add(key);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])queue.push([x+dx,y+dy]);}
    for(const item of state.items){assert.ok(canStand(item.x,item.y));assert.ok(visited.has(`${Math.floor(item.x)},${Math.floor(item.y)}`));assert.ok(!HAZARDS.some(h=>Math.floor(item.x)===h.x&&Math.floor(item.y)===h.y));}
    assert.deepEqual([...new Set([...state.items.map(i=>i.kind),...(!solo?['repair']:[])])].sort(),['boost','link','repair','scan','shield']);
  }
});
test('repair triggers once, respects max HP and stays on ground at full health',()=>{
  const {state,team}=collect('repair');assert.equal(team.hp,80);assert.ok(state.items[0].taken);
  step(state,{},.01);assert.equal(team.hp,80);
  state.items[0].taken=false;team.hp=100;step(state,{},.01);assert.equal(state.items[0].taken,false);
  team.hp=90;step(state,{},.01);assert.equal(team.hp,100);
});
test('shield blocks exactly one shot, expires, and never protects against hazards',()=>{
  const {state,team}=collect('shield');const enemy=state.teams[1];
  Object.assign(team,{x:2.5,y:12.5});Object.assign(enemy,{x:4.5,y:12.5,angle:Math.PI,pitch:0});
  step(state,{'b-upper':{fire:true}},.01);assert.equal(team.hp,100);assert.equal(team.shield,0);
  enemy.cooldown=0;step(state,{'b-upper':{fire:true}},.01);assert.equal(team.hp,75);
  team.shield=.01;enemy.cooldown=0;step(state,{'b-upper':{fire:true}},.02);assert.equal(team.hp,50);
  Object.assign(team,{x:6.5,y:4.5,shield:8});step(state,{},.05);assert.ok(team.hp<50);assert.ok(team.shield>0);
});
test('boost is 1.3x in every direction and expires back to normal speed',()=>{
  const {state,team}=collect('boost');Object.assign(team,{x:3,y:12,angle:0});
  const x=team.x;step(state,{'a-lower':{forward:1}},.05);assert.ok(Math.abs(team.x-x-2.35*1.3*.05)<1e-8);
  team.boost=.01;const y=team.y;step(state,{'a-lower':{strafe:1}},.05);assert.ok(Math.abs(team.y-y-2.35*.05)<1e-8);
});
test('link shares enemies and pickups only with its team, then restores role separation',()=>{
  const {state,team}=collect('link');
  assert.ok(visibleEntities(state,'a-upper').some(e=>e.type==='opponent'));
  assert.ok(visibleEntities(state,'a-upper').some(e=>e.type==='core'));
  assert.equal(visibleEntities(state,'b-upper').length,0);
  team.link=.01;step(state,{},.02);assert.equal(visibleEntities(state,'a-upper').length,0);
});
test('scan captures enemy positions once, is team-only, expires and does not spend the G ping',()=>{
  const {state,team}=collect('scan'),saved={...visibleScans(state,'a-upper')[0]};
  assert.equal(visibleScans(state,'a-lower').length,1);assert.equal(visibleScans(state,'b-upper').length,0);
  state.teams[1].x-=1;step(state,{},.05);assert.equal(team.scans[0].x,saved.x);assert.equal(team.pingCooldown,0);
  for(let i=0;i<61;i++)step(state,{},.05);assert.equal(team.scans.length,0);
});
test('pickup ties do not favor one team, and round reset clears buffs and respawns items',()=>{
  const state=createState(),[a,b]=state.teams;state.items=[{id:'tie',kind:'shield',x:3,y:12,taken:false}];
  Object.assign(a,{x:2.75,y:12});Object.assign(b,{x:3.25,y:12});step(state,{},.01);assert.equal(state.items[0].taken,false);
  b.x=4;step(state,{},.01);assert.ok(a.shield>0);assert.ok(state.items[0].taken);
  state.time=.001;step(state,{},.01);state.intermission=0;step(state,{},.01);
  assert.equal(a.shield,0);assert.equal(a.boost,0);assert.equal(a.link,0);assert.deepEqual(a.scans,[]);assert.equal(state.items[0].taken,false);
});
test('practice still requires four cores; powerups do not count toward the exit',()=>{
  const {state}=collect('repair',true);assert.equal(state.collected,0);assert.equal(state.cores.length,4);
});
