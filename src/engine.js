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
export const ROUND_SECONDS=90, ROUND_COUNT=3, ROUND_BREAK=5, SHOT_DAMAGE=25;
export const PING_COOLDOWN=15, PING_LIFETIME=6;
export const ITEM_INFO={repair:{name:'修理パック',color:'#d6fa70',symbol:'+'},shield:{name:'シールド',color:'#79efff',symbol:'◇'},boost:{name:'加速バッテリー',color:'#ffd36e',symbol:'»'},link:{name:'視界リンク',color:'#df9dff',symbol:'∞'},scan:{name:'スキャンパルス',color:'#ffad97',symbol:'◎'}};
const freshEffects=()=>({emote:null,emoteCooldown:0,sprayCooldown:0,shield:0,boost:0,link:0,scans:[],pickup:null});
function createItems(solo){
  const positions={shield:[[3.5,12.5],[16.5,3.5]],boost:[[5.5,10.5],[14.5,5.5]],link:[[8.5,7.5],[11.5,8.5]],scan:[[5.5,5.5],[14.5,10.5]]};
  if(solo)positions.repair=[[4.5,12.5],[15.5,3.5]];
  return Object.entries(positions).flatMap(([kind,points])=>points.map(([x,y],i)=>({id:`${kind}-${i}`,kind,x,y,taken:false})));
}
export const EYE_HEIGHT=.96, ROBOT_HEIGHT=1.3, WALL_HEIGHT=1.8, MAX_PITCH=Math.PI/3;
export const blankInput = () => ({forward:0,strafe:0,bodyTurn:0,turn:0,look:0,pitchTurn:0,pitchLook:0,fire:false});
export const normalizeAngle = a => Math.atan2(Math.sin(a),Math.cos(a));
export const isWall = (x,y) => MAP[Math.floor(y)]?.[Math.floor(x)] !== '0';
export const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);

export function createState(solo=false) {
  const state = {
    solo, mode:solo?'practice':'duel', status:'playing', time:360, elapsed:0, collected:0, shots:[], signals:[], pings:[], sprays:[], kills:0,
    teams:[{id:'a',x:2.5,y:13.2,angle:-Math.PI/2,hp:100,cooldown:0,hurt:0,revive:0},
      {id:'b',x:4,y:13.2,angle:-Math.PI/2,hp:100,cooldown:0,hurt:0,revive:0}],
    cores:[{id:0,x:3.5,y:10.3,taken:false},{id:1,x:3,y:2.5,taken:false},
      {id:2,x:11,y:7.5,taken:false},{id:3,x:16.5,y:11.5,taken:false}],
    enemies:[{id:0,x:5.2,y:9.7,hp:2,hit:0},{id:1,x:6.4,y:2.3,hp:2,hit:0},
      {id:2,x:10.5,y:5.2,hp:2,hit:0},{id:3,x:15.6,y:10,hp:2,hit:0},
      {id:4,x:16.2,y:3.5,hp:2,hit:0}],
  };
  state.items=createItems(solo);
  state.teams.forEach(team=>Object.assign(team,freshEffects()));
  state.teams.forEach(team=>Object.assign(team,{bodyAngle:team.angle,pitch:0,gait:0,moveSpeed:0,pingCooldown:0}));
  if(!solo){
    Object.assign(state,{round:1,scores:{a:0,b:0},rounds:[],winner:null,roundWinner:null,intermission:0});
    resetDuelRound(state);
  }
  return state;
}

function resetDuelRound(state){
  const spawns=[{x:2.5,y:13.2,angle:-Math.PI/2},{x:17.5,y:2.8,angle:Math.PI/2}];
  state.teams.forEach((team,i)=>Object.assign(team,spawns[(i+state.round-1)%2],{hp:100,cooldown:0,hurt:0,revive:0}));
  state.teams.forEach(team=>Object.assign(team,{bodyAngle:team.angle,pitch:0,gait:0,moveSpeed:0,pingCooldown:0}));
  state.cores.forEach(core=>{core.taken=false;});
  state.items.forEach(item=>{item.taken=false;});
  state.teams.forEach(team=>Object.assign(team,freshEffects()));
  state.enemies=[];state.time=ROUND_SECONDS;state.status='playing';state.shots=[];state.signals=[];state.pings=[];state.sprays=[];
  state.collected=0;state.roundWinner=null;state.reason='';state.intermission=0;
}

function finishRound(state,winner,reason){
  state.roundWinner=winner;state.reason=reason;
  state.rounds.push({round:state.round,winner,reason,hp:state.teams.map(t=>t.hp)});
  if(winner)state.scores[winner]++;
  if(state.round===ROUND_COUNT){
    state.status='finished';
    state.winner=state.scores.a===state.scores.b?null:state.scores.a>state.scores.b?'a':'b';
  }else{state.status='round-over';state.intermission=ROUND_BREAK;}
}

export function sanitizeInput(data={}) {
  if(!data||typeof data!=='object')data={};
  const number=(n,limit=1)=>Number.isFinite(n)?Math.max(-limit,Math.min(limit,n)):0;
  return {forward:number(data.forward),strafe:number(data.strafe),bodyTurn:number(data.bodyTurn),turn:number(data.turn),look:number(data.look,.35),pitchTurn:number(data.pitchTurn),pitchLook:number(data.pitchLook,.35),fire:data.fire===true};
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

function moveAndLook(team,inputs,dt){
  const lower=sanitizeInput(inputs[`${team.id}-lower`]),upper=sanitizeInput(inputs[`${team.id}-upper`]);
  // Movement follows the shared view; vertical aim never changes ground speed.
  team.angle=normalizeAngle(team.angle+upper.turn*2.05*dt+upper.look);
  team.pitch=Math.max(-MAX_PITCH,Math.min(MAX_PITCH,team.pitch+upper.pitchTurn*1.35*dt+upper.pitchLook));
  team.bodyAngle=team.angle;
  advanceMovement(team,lower,dt);
  return upper;
}

// Shared movement-only simulation for host authority and client prediction.
// Does not collect items, apply damage, shoot, or advance the match clock.
export function advanceMovement(team,input,dt){
  const lower=sanitizeInput(input);
  dt=Math.max(0,Math.min(dt,.05));
  const speed=2.35*(team.boost>0?1.3:1)*dt/Math.max(1,Math.hypot(lower.forward,lower.strafe)),x=team.x,y=team.y;
  move(team,(Math.cos(team.bodyAngle)*lower.forward-Math.sin(team.bodyAngle)*lower.strafe)*speed,
    (Math.sin(team.bodyAngle)*lower.forward+Math.cos(team.bodyAngle)*lower.strafe)*speed);
  const travelled=Math.hypot(team.x-x,team.y-y);
  team.gait=(team.gait+travelled*9)%(Math.PI*2);
  team.moveSpeed+=(Math.min(1,travelled/Math.max(dt*2.35,1e-8))-team.moveSpeed)*Math.min(1,dt*14);

}

export function placePing(state,slot){
  if(!SLOTS.includes(slot)||!slot.endsWith('upper')||state.status!=='playing')return false;
  const team=state.teams.find(t=>t.id===slot[0]);
  if(!team||team.hp<=0||team.pingCooldown>1e-8)return false;
  const wall=raycast(team.x,team.y,team.angle),slope=Math.tan(team.pitch);
  const verticalLimit=slope<0?-EYE_HEIGHT/slope:slope>0?(WALL_HEIGHT-EYE_HEIGHT)/slope:Infinity;
  const d=Math.max(0,Math.min(wall.distance,verticalLimit)-.04);
  state.pings=state.pings.filter(p=>p.team!==team.id);
  state.pings.push({team:team.id,x:team.x+Math.cos(team.angle)*d,y:team.y+Math.sin(team.angle)*d,z:EYE_HEIGHT+slope*d,life:PING_LIFETIME});
  team.pingCooldown=PING_COOLDOWN;
  return true;
}

export const EMOTES=['wave','salute','sway'],SPRAY_STYLES=['link','star','smile'];
export function startEmote(state,slot,kind='wave'){
  if(!state||!SLOTS.includes(slot)||!EMOTES.includes(kind)||state.status!=='playing')return false;
  const team=state.teams.find(t=>t.id===slot[0]);
  if(!team||team.hp<=0||team.emoteCooldown>0)return false;
  team.emote={kind,life:3};team.emoteCooldown=5;return true;
}
export function placeSpray(state,slot,style='link'){
  if(!state||!SLOTS.includes(slot)||!SPRAY_STYLES.includes(style)||state.status!=='playing')return false;
  const team=state.teams.find(t=>t.id===slot[0]);
  if(!team||team.hp<=0||team.sprayCooldown>0)return false;
  const hit=raycast(team.x,team.y,team.angle),slope=Math.tan(team.pitch);
  const floorD=slope<-.001?-EYE_HEIGHT/slope:Infinity;
  const floor=floorD<hit.distance,d=floor?floorD:hit.distance,z=floor?0:EYE_HEIGHT+slope*d;
  if(Math.hypot(d,z-EYE_HEIGHT)>3||z<0||z>WALL_HEIGHT)return false;
  let x=team.x+Math.cos(team.angle)*d,y=team.y+Math.sin(team.angle)*d;
  let nx=0,ny=0;
  if(floor){if(!canStand(x,y,.27))return false;}
  else{
    if(hit.side){ny=-Math.sign(Math.sin(team.angle));x=Math.max(Math.floor(x)+.28,Math.min(Math.floor(x)+.72,x));y+=ny*.012;}
    else{nx=-Math.sign(Math.cos(team.angle));y=Math.max(Math.floor(y)+.28,Math.min(Math.floor(y)+.72,y));x+=nx*.012;}
  }
  state.sprays??=[];
  state.sprays.push({team:team.id,style,x,y,z:floor ? .012 :Math.max(.28,Math.min(WALL_HEIGHT-.28,z)),nx,ny,surface:floor?'floor':'wall'});
  if(state.sprays.length>24)state.sprays.shift();team.sprayCooldown=4;return true;
}

function tickPings(state,dt){
  state.pings=state.pings.filter(p=>(p.life-=dt)>0);
  for(const team of state.teams)team.pingCooldown=Math.max(0,team.pingCooldown-dt);
  for(const team of state.teams){
    team.emoteCooldown=Math.max(0,(team.emoteCooldown||0)-dt);team.sprayCooldown=Math.max(0,(team.sprayCooldown||0)-dt);
    if(team.emote&&(team.emote.life-=dt)<=0)team.emote=null;
    for(const effect of ['shield','boost','link'])team[effect]=Math.max(0,team[effect]-dt);
    team.scans=team.scans.filter(p=>(p.life-=dt)>0);
    if(team.pickup&&(team.pickup.life-=dt)<=0)team.pickup=null;
  }
}

function collectItems(state,active){
  const pickups=state.mode==='duel'?[...state.items,...state.cores.map(core=>({...core,kind:'repair',core}))]:state.items;
  for(const item of pickups){
    if(item.taken)continue;
    const nearby=active.filter(t=>t.hp>0&&(item.kind!=='repair'||t.hp<100)&&distance(t,item)<.57&&lineOfSight(t,item)).sort((a,b)=>distance(a,item)-distance(b,item));
    if(!nearby.length||(nearby.length>1&&Math.abs(distance(nearby[0],item)-distance(nearby[1],item))<1e-8))continue;
    const team=nearby[0];(item.core||item).taken=true;
    if(item.kind==='repair')team.hp=Math.min(100,team.hp+30);
    if(item.kind==='shield')team.shield=8;
    if(item.kind==='boost')team.boost=6;
    if(item.kind==='link')team.link=3;
    if(item.kind==='scan'){
      const targets=state.mode==='duel'?state.teams.filter(t=>t.id!==team.id):state.enemies;
      team.scans=targets.filter(t=>t.hp>0).map(t=>({x:t.x,y:t.y,z:EYE_HEIGHT,life:3,scan:true}));
    }
    team.pickup={kind:item.kind,life:3};
  }
}

function enemyDamage(team,amount){
  if(team.shield>0){team.shield=0;team.pickup={kind:'blocked',life:2};return;}
  team.hp=Math.max(0,team.hp-amount);team.hurt=.25;
}

function shoot(state,team,damage){
  const wall=raycast(team.x,team.y,team.angle);
  const slope=Math.tan(team.pitch);
  const verticalLimit=slope>0?(WALL_HEIGHT-EYE_HEIGHT)/slope:slope<0?-EYE_HEIGHT/slope:Infinity;
  let target=null,best=Math.min(wall.distance,verticalLimit);
  const targets=state.mode==='duel'?state.teams.filter(t=>t.id!==team.id):state.enemies;
  for(const enemy of targets){
    if(enemy.hp<=0)continue;
    const d=distance(team,enemy),angle=normalizeAngle(Math.atan2(enemy.y-team.y,enemy.x-team.x)-team.angle);
    const hitHeight=EYE_HEIGHT+slope*d*Math.cos(angle);
    const inHeight=state.mode==='duel'?hitHeight>=.06&&hitHeight<=ROBOT_HEIGHT:hitHeight>=EYE_HEIGHT-.27&&hitHeight<=EYE_HEIGHT+.27;
    if(inHeight&&Math.abs(angle)<Math.atan2(.32,d)&&d<best&&lineOfSight(team,enemy)){target=enemy;best=d;}
  }
  if(target){
    if(state.mode==='duel')damage[target.id]=(damage[target.id]||0)+SHOT_DAMAGE;
    else {target.hp--;target.hit=.18;if(target.hp<=0)state.kills++;}
  }
  state.shots.push({team:team.id,x:team.x,y:team.y,angle:team.angle,pitch:team.pitch,distance:best,life:.16,hit:!!target});
  team.cooldown=.3;
}

export function step(state,inputs,dt){
  if(state.mode==='duel'){stepDuel(state,inputs,dt);return;}
  if(state.status!=='playing')return;
  dt=Math.max(0,Math.min(dt,.05));
  state.time=Math.max(0,state.time-dt);state.elapsed+=dt;
  tickPings(state,dt);
  state.shots=state.shots.filter(s=>(s.life-=dt)>0);
  state.signals=state.signals.filter(s=>(s.life-=dt)>0);
  const active=state.solo?state.teams.slice(0,1):state.teams;
  for(const team of active){
    team.cooldown=Math.max(0,team.cooldown-dt);team.hurt=Math.max(0,team.hurt-dt);
    if(team.hp<=0)continue;
    const upper=moveAndLook(team,inputs,dt);
    if(upper.fire&&team.cooldown<=0)shoot(state,team);
    for(const core of state.cores){if(!core.taken&&distance(team,core)<.57){core.taken=true;state.collected++;}}
    if(HAZARDS.some(h=>Math.floor(team.x)===h.x&&Math.floor(team.y)===h.y)){
      team.hp=Math.max(0,team.hp-14*dt);team.hurt=.2;
    }
  }
  collectItems(state,active);
  for(const enemy of state.enemies){
    enemy.hit=Math.max(0,enemy.hit-dt);if(enemy.hp<=0)continue;
    const targets=active.filter(t=>t.hp>0&&distance(t,enemy)<6&&lineOfSight(enemy,t)).sort((a,b)=>distance(a,enemy)-distance(b,enemy));
    if(!targets.length)continue;
    const target=targets[0],d=distance(target,enemy);
    if(d>.65){const speed=(state.solo?.46:.6)*dt;move(enemy,(target.x-enemy.x)/d*speed,(target.y-enemy.y)/d*speed,.2);}
    else {enemy.attackCooldown=Math.max(0,(enemy.attackCooldown||0)-dt);if(enemy.attackCooldown<=0){enemyDamage(target,8);enemy.attackCooldown=.8;}}
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

function stepDuel(state,inputs,dt){
  dt=Math.max(0,Math.min(dt,.05));
  if(state.status==='round-over'){
    state.intermission=Math.max(0,state.intermission-dt);
    if(state.intermission<=1e-8){state.round++;resetDuelRound(state);}
    return;
  }
  if(state.status!=='playing')return;
  state.time=Math.max(0,state.time-dt);state.elapsed+=dt;
  tickPings(state,dt);
  state.shots=state.shots.filter(s=>(s.life-=dt)>0);
  state.signals=state.signals.filter(s=>(s.life-=dt)>0);
  for(const team of state.teams){
    team.cooldown=Math.max(0,team.cooldown-dt);team.hurt=Math.max(0,team.hurt-dt);
    if(team.hp<=0)continue;
    moveAndLook(team,inputs,dt);
    if(HAZARDS.some(h=>Math.floor(team.x)===h.x&&Math.floor(team.y)===h.y)){
      team.hp=Math.max(0,team.hp-14*dt);team.hurt=.2;
    }
  }
  collectItems(state,state.teams);
  // Apply both players' shots together so simultaneous knockouts are a draw.
  const damage={};
  for(const team of state.teams){
    if(team.hp>0&&team.cooldown<=0&&sanitizeInput(inputs[`${team.id}-upper`]).fire)shoot(state,team,damage);
  }
  for(const team of state.teams)if(damage[team.id])enemyDamage(team,damage[team.id]);
  const [a,b]=state.teams;
  if(a.hp<=0&&b.hp<=0)finishRound(state,null,'両機が同時に停止');
  else if(a.hp<=0||b.hp<=0)finishRound(state,a.hp>0?'a':'b','相手機体を撃破');
  else if(state.time<=1e-8){
    const hpA=Math.ceil(a.hp),hpB=Math.ceil(b.hp),tied=hpA===hpB;
    finishRound(state,tied?null:hpA>hpB?'a':'b',tied?'時間切れ・残りHPが同じ':'時間切れ・残りHPで判定');
  }
}

export function addSignal(state,slot,index){
  if(!SLOTS.includes(slot)||![0,1].includes(index))return;
  const upper=slot.endsWith('upper');
  const text=upper?['進んで大丈夫！','止まって！ 危険な床！'][index]:['正面に敵！ 照準を合わせて！','コアが見える！ この方向へ！'][index];
  state.signals=state.signals.filter(s=>s.team!==slot[0]);
  state.signals.push({team:slot[0],text,from:upper?'上半身':'下半身',life:3});
}
