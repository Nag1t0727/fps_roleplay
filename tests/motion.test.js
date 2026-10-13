import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MotionView,HostCamera} from '../src/motion.js';
import {createState,advanceMovement,blankInput,canStand} from '../src/engine.js';
const input={...blankInput(),forward:1};
function snapshot(x,angle=0){const s=createState();Object.assign(s.teams[0],{x,y:13,angle,bodyAngle:angle,pitch:0});return s;}
const meta=(at,acks={})=>({at,epoch:1,acks});

test('poses interpolate every rendered frame, angles take the shortest route, authoritative state is untouched',()=>{
  const view=new MotionView(),a=snapshot(2,3.1),b=snapshot(2.5,-3.1);
  view.receive(a,meta(0),'a-upper',100);view.receive(b,meta(100),'a-upper',200);
  const xs=[];
  for(let now=200;now<=300;now+=20)xs.push(view.sample(b,'a-upper',now,.02,blankInput(),0).teams[0].x);
  assert.deepEqual(xs,[2,2.1,2.2,2.3,2.4,2.5]);
  const halfway=view.sample(b,'a-upper',250,.02,blankInput(),0).teams[0];
  assert.ok(Math.abs(halfway.angle)>3.1);assert.equal(b.teams[0].x,2.5);assert.equal(b.teams[0].angle,-3.1);
});

test('lower movement starts before any host response and respects the same walls and boost speed',()=>{
  const s=snapshot(2),view=new MotionView();view.receive(s,meta(0),'a-lower',100);
  const result=view.sample(s,'a-lower',116,.016,input,1).teams[0];assert.ok(result.x>2);assert.equal(s.teams[0].x,2);
  const wall=snapshot(18.76);wall.teams[0].boost=5;view.clear();view.receive(wall,meta(0),'a-lower',100);
  for(let now=116;now<390;now+=16){const team=view.sample(wall,'a-lower',now,.016,input,1).teams[0];assert.ok(canStand(team.x,team.y));assert.ok(team.x<18.79);}
  const boosted=snapshot(2);boosted.teams[0].boost=5;const model={...boosted.teams[0]};advanceMovement(model,input,.016);
  view.clear();view.receive(boosted,meta(0),'a-lower',100);assert.equal(view.sample(boosted,'a-lower',116,.016,input,1).teams[0].x,model.x);
});

test('acknowledged durations are not replayed twice and small corrections do not jump on receipt',()=>{
  const s=snapshot(2),view=new MotionView();view.receive(s,meta(0),'a-lower',0);
  for(let i=0;i<6;i++)view.sample(s,'a-lower',(i+1)*16,.016,input,i<3?1:2);
  const before=view.predicted.x;
  const authoritative=snapshot(2+2.35*.064);
  view.receive(authoritative,meta(64,{'a-lower':{seq:2,elapsed:.016}}),'a-lower',100);
  assert.ok(Math.abs(view.predicted.x-before)<1e-8);
  view.receive(snapshot(2.1),meta(80,{'a-lower':{seq:2,elapsed:.032}}),'a-lower',110);
  assert.ok(Math.abs(view.predicted.x+view.errorX-before)<1e-8);
  const final=snapshot(2.2);view.receive(final,meta(100,{'a-lower':{seq:2,elapsed:.1}}),'a-lower',120);
  assert.equal(view.history.length,0);assert.equal(view.predicted.x,2.2);
});

test('packet outage and paused matches stop prediction; new rounds, roles and rematches reset history',()=>{
  const s=snapshot(2),view=new MotionView();view.receive(s,meta(0),'a-lower',0);
  view.sample(s,'a-lower',16,.016,input,1);view.sample(s,'a-lower',400,.016,input,1);
  assert.equal(view.history.length,0);assert.equal(view.predicted.x,2);
  view.sample(s,'a-lower',410,.016,input,1);assert.equal(view.predicted.x,2);
  view.receive(s,meta(500),'a-lower',500);view.sample(s,'a-lower',516,.016,input,2,false);assert.equal(view.predicted.x,2);
  const next=snapshot(17);next.round=2;view.receive(next,meta(550),'a-lower',550);
  assert.equal(view.history.length,0);assert.equal(view.predicted.x,17);assert.equal(view.errorX,0);
  view.receive(next,meta(600),'a-upper',600);assert.equal(view.predicted,null);
  view.receive(s,{...meta(650),epoch:2},'a-lower',650);assert.equal(view.predicted.x,2);
});

test('prediction and correction never apply damage, pickups, shooting or round changes',()=>{
  const s=snapshot(2),before=structuredClone(s),view=new MotionView();view.receive(s,meta(0),'a-lower',0);
  for(let i=0;i<15;i++)view.sample(s,'a-lower',i*16,.016,{...input,fire:true},1);
  assert.deepEqual(s,before);
});

test('host lower camera smooths remote aim without changing authoritative aim or position',()=>{
  const camera=new HostCamera(),state=snapshot(2,3.1);camera.sample(state,'a-lower',.016);
  state.teams[0].angle=-3.1;state.teams[0].pitch=.5;
  const view=camera.sample(state,'a-lower',.016);
  assert.ok(Math.abs(view.teams[0].angle)>3.1);assert.ok(view.teams[0].pitch>0&&view.teams[0].pitch<.5);
  assert.equal(state.teams[0].pitch,.5);assert.equal(view.teams[0].x,state.teams[0].x);
  state.round=2;assert.equal(camera.sample(state,'a-lower',.016).teams[0].pitch,.5);
});
