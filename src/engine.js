// Pure simulation: only the host advances this state. Angles: east = 0, south = π/2.
export const MAP = [
  '11111111111111111111',
  '10000000010000000001',
  '10000000010000000001',
  '10001100010001100001',
  '10001100000001100001',
  '10000000000000000001',
  '10000011100111000001',
  '10000010000001000001',
  '11100010000001000111',
  '10000000000000000001',
  '10000000000000000001',
  '10001110000111000001',
  '10000000000000000001',
  '10000000000000000001',
  '10000000000000000001',
  '11111111111111111111',
];
export const WIDTH = MAP[0].length, HEIGHT = MAP.length;
export const EXIT = {x:17.5,y:2.5,radius:1.45};
export const HAZARDS = [{x:6,y:4},{x:7,y:4},{x:12,y:9},{x:13,y:9},{x:4,y:9},{x:15,y:5}];
export const SLOTS = ['a-lower','a-upper','b-lower','b-upper'];
export const SLOT_LABELS = {'a-lower':'A / 下半身','a-upper':'A / 上半身','b-lower':'B / 下半身','b-upper':'B / 上半身'};
export const blankInput = () => ({forward:0,strafe:0,turn:0,look:0,fire:false});
export const normalizeAngle = a => Math.atan2(Math.sin(a),Math.cos(a));
export const isWall = (x,y) => MAP[Math.floor(y)]?.[Math.floor(x)] !== '0';
export const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);

export function createState(solo=false) {
  return {
    solo, status:'playing', time:360, elapsed:0, collected:0, shots:[], signals:[], kills:0,
    teams:[{id:'a',x:2.5,y:13.2,angle:-Math.PI/2,hp:100,cooldown:0,hurt:0,revive:0},
      {id:'b',x:4,y:13.2,angle:-Math.PI/2,hp:100,cooldown:0,hurt:0,revive:0}],
    cores:[{id:0,x:3.5,y:10.3,taken:false},{id:1,x:3,y:2.5,taken:false},
      {id:2,x:11,y:7.5,taken:false},{id:3,x:16.5,y:11.5,taken:false}],
    enemies:[{id:0,x:5.2,y:9.7,hp:2,hit:0},{id:1,x:6.4,y:2.3,hp:2,hit:0},
      {id:2,x:10.5,y:5.2,hp:2,hit:0},{id:3,x:15.6,y:10,hp:2,hit:0},
      {id:4,x:16.2,y:3.5,hp:2,hit:0}],
  };
}

export function sanitizeInput(data={}) {
  if(!data||typeof data!=='object')data={};
  const number=(n,limit=1)=>Number.isFinite(n)?Math.max(-limit,Math.min(limit,n)):0;
  return {forward:number(data.forward),strafe:number(data.strafe),turn:number(data.turn),look:number(data.look,.35),fire:data.fire===true};
}

export function raycast(x,y,angle,max=28) {
  const dx=Math.cos(angle),dy=Math.sin(angle);
  let mx=Math.floor(x),my=Math.floor(y);
  const ddx=Math.abs(1/(dx||1e-10)),ddy=Math.abs(1/(dy||1e-10));
  const sx=dx<0?-1:1,sy=dy<0?-1:1;
  let tx=(dx<0?x-mx:mx+1-x)*ddx,ty=(dy<0?y-my:my+1-y)*ddy;
  let d=0,side=0;
  for(let i=0;i<120;i++) {
    if(tx<ty){d=tx;tx+=ddx;mx+=sx;side=0;}else{d=ty;ty+=ddy;my+=sy;side=1;}
    if(d>max) return {distance:max,side,x:x+dx*max,y:y+dy*max};
    if(MAP[my]?.[mx]!=='0') return {distance:Math.max(.01,d),side,x:x+dx*d,y:y+dy*d};
  }
  return {distance:max,side,x:x+dx*max,y:y+dy*max};
}

export function canStand(x,y,r=.22) {
  return ![[x-r,y-r],[x+r,y-r],[x-r,y+r],[x+r,y+r]].some(([a,b])=>isWall(a,b));
}
export function move(body,dx,dy,r=.22){
  if(canStand(body.x+dx,body.y,r))body.x+=dx;
  if(canStand(body.x,body.y+dy,r))body.y+=dy;
}
export function lineOfSight(a,b){return raycast(a.x,a.y,Math.atan2(b.y-a.y,b.x-a.x)).distance>=distance(a,b)-.12;}

function shoot(state,team){
  const wall=raycast(team.x,team.y,team.angle);
  let target=null,best=wall.distance;
  for(const enemy of state.enemies){
    if(enemy.hp<=0)continue;
    const d=distance(team,enemy),angle=normalizeAngle(Math.atan2(enemy.y-team.y,enemy.x-team.x)-team.angle);
    if(Math.abs(angle)<Math.atan2(.32,d)&&d<best&&lineOfSight(team,enemy)){target=enemy;best=d;}
  }
  if(target){target.hp--;target.hit=.18;if(target.hp<=0)state.kills++;}
  state.shots.push({team:team.id,x:team.x,y:team.y,angle:team.angle,distance:best,life:.16,hit:!!target});
  team.cooldown=.3;
}

export function step(state,inputs,dt){
  if(state.status!=='playing')return;
  dt=Math.max(0,Math.min(dt,.05));
  state.time=Math.max(0,state.time-dt);state.elapsed+=dt;
  state.shots=state.shots.filter(s=>(s.life-=dt)>0);
  state.signals=state.signals.filter(s=>(s.life-=dt)>0);
  const active=state.solo?state.teams.slice(0,1):state.teams;
  for(const team of active){
    team.cooldown=Math.max(0,team.cooldown-dt);team.hurt=Math.max(0,team.hurt-dt);
    if(team.hp<=0)continue;
    const lower=sanitizeInput(inputs[`${team.id}-lower`]),upper=sanitizeInput(inputs[`${team.id}-upper`]);
    team.angle=normalizeAngle(team.angle+upper.turn*2.05*dt+upper.look);
    const len=Math.max(1,Math.hypot(lower.forward,lower.strafe));
    const speed=2.35*dt/len;
    move(team,(Math.cos(team.angle)*lower.forward-Math.sin(team.angle)*lower.strafe)*speed,
      (Math.sin(team.angle)*lower.forward+Math.cos(team.angle)*lower.strafe)*speed);
    if(upper.fire&&team.cooldown<=0)shoot(state,team);
    for(const core of state.cores){if(!core.taken&&distance(team,core)<.57){core.taken=true;state.collected++;}}
    if(HAZARDS.some(h=>Math.floor(team.x)===h.x&&Math.floor(team.y)===h.y)){
      team.hp=Math.max(0,team.hp-14*dt);team.hurt=.2;
    }
  }
  for(const enemy of state.enemies){
    enemy.hit=Math.max(0,enemy.hit-dt);if(enemy.hp<=0)continue;
    const targets=active.filter(t=>t.hp>0&&distance(t,enemy)<6&&lineOfSight(enemy,t)).sort((a,b)=>distance(a,enemy)-distance(b,enemy));
    if(!targets.length)continue;
    const target=targets[0],d=distance(target,enemy);
    if(d>.65){const speed=(state.solo?.46:.6)*dt;move(enemy,(target.x-enemy.x)/d*speed,(target.y-enemy.y)/d*speed,.2);}
    else {target.hp=Math.max(0,target.hp-10*dt);target.hurt=.25;}
  }
  for(const team of active){
    if(team.hp>0)continue;
    const helper=active.find(t=>t.hp>0&&distance(t,team)<2&&lineOfSight(t,team));
    team.revive=helper?team.revive+dt:0;
    if(team.revive>=4){team.hp=55;team.revive=0;}
  }
  if(active.every(t=>t.hp<=0)){state.status='lost';state.reason='すべての機体が停止しました。';}
  else if(state.time<=0){state.status='lost';state.reason='制限時間を超過しました。';}
  else if(state.collected===4&&active.every(t=>t.hp>0&&distance(t,EXIT)<EXIT.radius)){state.status='won';}
}

export function addSignal(state,slot,index){
  if(!SLOTS.includes(slot)||![0,1].includes(index))return;
  const upper=slot.endsWith('upper');
  const text=upper?['進んで大丈夫！','止まって！ 危険な床！'][index]:['正面に敵！ 照準を合わせて！','コアが見える！ この方向へ！'][index];
  state.signals=state.signals.filter(s=>s.team!==slot[0]);
  state.signals.push({team:slot[0],text,from:upper?'上半身':'下半身',life:3});
}
