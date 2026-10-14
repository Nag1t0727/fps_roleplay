import {MAP,WIDTH,HEIGHT,HAZARDS,EXIT,raycast,normalizeAngle,distance,EYE_HEIGHT,WALL_HEIGHT,ROBOT_HEIGHT,ITEM_INFO,canStand} from './engine.js?v=cosmetics-3';
import {OutdoorEnvironment} from './environment.js?v=cosmetics-3';
import {drawHumanoid,emoteSway} from './humanoid.js?v=cosmetics-3';
import {drawSprays} from './sprays.js?v=cosmetics-3';

export function visibleEntities(state,slot){
  const upper=slot.endsWith('upper'),entities=[];
  if(!upper||state.teams.find(t=>t.id===slot[0])?.link>0){
    state.enemies.filter(e=>e.hp>0).forEach(e=>entities.push({...e,type:'enemy'}));
    state.cores.filter(e=>!e.taken).forEach(e=>entities.push({...e,type:'core'}));
    state.items.filter(e=>!e.taken).forEach(e=>entities.push({...e,type:'item'}));
    if(state.mode==='duel')state.teams.filter(t=>t.id!==slot[0]&&t.hp>0).forEach(t=>entities.push({...t,type:'opponent'}));
  }
  if((upper||state.teams.find(t=>t.id===slot[0])?.link>0)&&state.mode!=='duel')entities.push({...EXIT,type:'exit'});
  return entities;
}
export const visiblePings=(state,slot)=>(state.pings||[]).filter(p=>p.team===slot[0]&&p.life>0);
export const visibleScans=(state,slot)=>state.teams.find(t=>t.id===slot[0])?.scans.filter(p=>p.life>0)||[];

// Camera-only offset: never changes movement, aim, hitboxes or role visibility.
export function emoteCamera(team){
  if(!(team.emote?.life>0)||team.hp<=0)return team;
  let best=null;
  for(const offset of [Math.PI,Math.PI*.75,-Math.PI*.75,Math.PI/2,-Math.PI/2,0]){
    const angle=team.angle+offset;
    const limit=Math.min(2.6,Math.max(0,raycast(team.x,team.y,angle).distance-.18));
    let d=0;
    for(let step=.04;step<=limit;step+=.04){
      if(!canStand(team.x+Math.cos(angle)*step,team.y+Math.sin(angle)*step,.12))break;
      d=step;
    }
    if(!best||d>best.d)best={angle,d};
    if(offset===Math.PI&&d>=1.8)break;
  }
  return {...team,x:team.x+Math.cos(best.angle)*best.d,y:team.y+Math.sin(best.angle)*best.d,
    angle:normalizeAngle(best.angle+Math.PI),pitch:-.10};
}

export class Renderer {
  constructor(canvas,bodyCanvas=null){this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.bodyCanvas=bodyCanvas;this.depth=[];this.environment=new OutdoorEnvironment(WIDTH,HEIGHT);}
  draw(state,slot){
    const {ctx:c,canvas}=this;
    const w=canvas.width,h=canvas.height,upper=slot.endsWith('upper')||state.teams.find(t=>t.id===slot[0])?.link>0;
    const actor=state.teams.find(t=>t.id===slot[0])||state.teams[0];
    const team=emoteCamera(actor),thirdPerson=team!==actor;
    canvas.dataset.perspective=thirdPerson?'third-person':'first-person';
    const plane=w*.72,horizon=h*.5+Math.tan(team.pitch)*plane;
    this.horizon=horizon;
    this.environment.draw(c,team,w,h,plane,horizon,EYE_HEIGHT,upper);
    // Project floor tiles in world space, then let the depth-correct walls occlude them.
    if(upper){
      for(let y=1;y<HEIGHT-1;y++)for(let x=1;x<WIDTH-1;x++){
        if(MAP[y][x]==='0'&&Math.hypot(x-team.x,y-team.y)<15)this.floorTile(team,x,y,plane,w,h,((x*13+y*7)%11===0)?'#393b3018':'#72726308');
      }
      for(const hazard of HAZARDS)this.floorTile(team,hazard.x,hazard.y,plane,w,h,'#cc573c99');
      if(state.mode!=='duel')for(let y=1;y<=3;y++)for(let x=16;x<=18;x++)this.floorTile(team,x,y,plane,w,h,state.collected===4?'#d6fa7080':'#548f8944');
    }else{
      // The seeker only sees a featureless collision silhouette, never the map or hazards.
      c.strokeStyle='#67839713';c.lineWidth=1;
      for(let y=horizon+20;y<h;y+=(y-horizon)*.28){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}
    }
    for(let x=0;x<w;x+=2){
      const offset=Math.atan((x-w/2)/plane),ray=raycast(team.x,team.y,team.angle+offset);
      const depth=ray.distance*Math.cos(offset);this.depth[x]=depth;this.depth[x+1]=depth;
      const wallH=WALL_HEIGHT*plane/depth,top=horizon-(WALL_HEIGHT-EYE_HEIGHT)*plane/depth;
      const light=Math.max(.14,1-depth/19)*(ray.side?.73:1);
      if(upper){
        const coordinate=ray.side?ray.x:ray.y,face=coordinate-Math.floor(coordinate);
        c.drawImage(this.environment.wall,Math.floor(face*255),0,1,256,x,top,2,wallH);
        const shade=(ray.side?.18:.04)+Math.min(.46,depth/45);
        c.fillStyle=`rgba(35,47,38,${shade})`;c.fillRect(x,top,2,wallH);
        c.fillStyle='#d3d0b68c';c.fillRect(x,top,2,Math.max(1,wallH*.018));
        c.fillStyle='#303d2a44';c.fillRect(x,top+wallH*.92,2,wallH*.08);
      }else{
        c.fillStyle=`rgb(${12+10*light},${21+15*light},${30+20*light})`;c.fillRect(x,top,2,wallH);
        c.fillStyle='#405a6b35';c.fillRect(x,top,2,1);c.fillRect(x,top+wallH,2,1);
      }
    }
    drawSprays(this,state.sprays||[],team,plane,w,h);
    const entities=visibleEntities(state,slot);
    if(thirdPerson)entities.push({...actor,type:'self'});
    entities.sort((a,b)=>distance(b,team)-distance(a,team));
    for(const entity of entities)this.sprite(entity,team,state,plane,w,h);
    // Upper body weapon belongs to both views, so the seeker can call out the aim.
    const firing=state.shots.some(s=>s.team===team.id&&s.life>.07);
    const bob=Math.sin(team.gait)*team.moveSpeed*6;
    if(!thirdPerson){
    this.drawHands(w,h,bob,firing,team);
    const weapon=c.createLinearGradient(w*.54,0,w*.67,0);weapon.addColorStop(0,'#1c2524');weapon.addColorStop(.35,'#57605b');weapon.addColorStop(.5,'#3f4742');weapon.addColorStop(1,'#151c1d');c.fillStyle=weapon;
    c.beginPath();c.moveTo(w*.57,h);c.lineTo(w*.57,h*.86+bob);c.lineTo(w*.54,h*.82+bob);c.lineTo(w*.54,h*.71+bob);c.lineTo(w*.59,h*.68+bob);c.lineTo(w*.64,h*.72+bob);c.lineTo(w*.67,h);c.fill();
    c.strokeStyle=upper?'#919789':'#5e7b91';c.lineWidth=2;c.stroke();
    c.fillStyle='#131e16';c.fillRect(w*.565,h*.725+bob,w*.045,h*.045);c.fillStyle='#d6fa70';c.fillRect(w*.575,h*.737+bob,w*.025,3);
    if(firing){c.fillStyle='#e5ffb2';c.beginPath();c.moveTo(w*.56,h*.69);c.lineTo(w*.52,h*.58);c.lineTo(w*.585,h*.63);c.lineTo(w*.62,h*.57);c.lineTo(w*.625,h*.7);c.fill();c.fillStyle='#d6fa7012';c.fillRect(0,0,w,h);}
    }else{
      c.save();c.fillStyle='#d6fa70';c.font='bold 16px sans-serif';c.textAlign='center';
      c.fillText('EMOTE / 三人称',w/2,90);c.restore();
    }
    if(upper)this.minimap(state,actor,w,h);
    else this.seekerBadge(c,w,h,state);
    this.bodyDirection(actor,w,h);
    for(const ping of visiblePings(state,slot))this.pingMarker(ping,team,plane,w,h);
    visibleScans(state,slot).forEach((scan,stack)=>this.pingMarker({...scan,stack},team,plane,w,h));
    if(this.bodyCanvas)this.bodyPreview(actor,firing);
    if(team.hurt>0){c.fillStyle=`rgba(218,55,38,${team.hurt*.5})`;c.fillRect(0,0,w,h);}
    if(team.hp<=0){c.fillStyle='#09100dde';c.fillRect(0,0,w,h);c.textAlign='center';c.fillStyle='#e5b18b';c.font='24px sans-serif';c.fillText('機体停止',w/2,h/2);c.textAlign='left';}
    const vignette=c.createRadialGradient(w/2,h/2,h*.18,w/2,h/2,w*.65);vignette.addColorStop(0,'transparent');vignette.addColorStop(1,'#101a183d');c.fillStyle=vignette;c.fillRect(0,0,w,h);
  }
  pingMarker(ping,team,plane,w,h){
    const c=this.ctx,angle=normalizeAngle(Math.atan2(ping.y-team.y,ping.x-team.x)-team.angle);
    const projected=this.project(ping,team,plane,w);
    const ahead=Math.cos(angle)>0&&projected;
    const x=ahead?Math.max(40,Math.min(w-40,projected.x)):(angle<0?40:w-40);
    let y=ahead?Math.max(110,Math.min(h-120,projected.y)):h*.5;
    const offscreen=!ahead||x!==projected.x||y!==projected.y;
    if(ping.scan&&offscreen)y=Math.min(h-120,140+(ping.stack||0)*60);
    const color=ping.scan?'#ffad97':'#79efff';
    c.save();c.strokeStyle=color;c.fillStyle='#091b28e8';c.lineWidth=3;
    c.beginPath();c.moveTo(x,y-13);c.lineTo(x+13,y);c.lineTo(x,y+13);c.lineTo(x-13,y);c.closePath();c.fill();c.stroke();
    c.font='bold 15px sans-serif';c.textAlign='center';c.fillStyle=color;
    c.fillText(`${offscreen?(angle<0?'◀ ':'▶ '):''}${ping.scan?'SCAN':'PIN'}`,x,y-22);
    c.fillText(`${distance(ping,team).toFixed(1)}m`,x,y+34);c.restore();
  }
  floorTile(team,x,y,plane,w,h,color,outline=false){
    const c=this.ctx,cos=Math.cos(team.angle),sin=Math.sin(team.angle);
    let vertices=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]].map(([px,py])=>({z:(px-team.x)*cos+(py-team.y)*sin,s:-(px-team.x)*sin+(py-team.y)*cos}));
    // Clip polygons at the near plane to avoid giant triangles behind the camera.
    const clipped=[];
    for(let i=0;i<vertices.length;i++){
      const a=vertices[i],b=vertices[(i+1)%vertices.length];
      if(a.z>=.12)clipped.push(a);
      if((a.z>=.12)!==(b.z>=.12)){const t=(.12-a.z)/(b.z-a.z);clipped.push({z:.12,s:a.s+(b.s-a.s)*t});}
    }
    if(clipped.length<3)return;
    c.beginPath();clipped.forEach((p,i)=>{const sx=w/2+p.s*plane/p.z,sy=this.horizon+EYE_HEIGHT*plane/p.z;i?c.lineTo(sx,sy):c.moveTo(sx,sy);});c.closePath();
    if(outline){c.strokeStyle=color;c.lineWidth=1;c.stroke();}else{c.fillStyle=color;c.fill();}
  }
  sprite(e,team,state,plane,w,h){
    const c=this.ctx,d=distance(e,team),angle=normalizeAngle(Math.atan2(e.y-team.y,e.x-team.x)-team.angle),z=d*Math.cos(angle);
    if(z<.18||Math.abs(angle)>1.2)return;
    const sx=w/2+Math.tan(angle)*plane,size=Math.min(h*2,plane/z*(['core','item'].includes(e.type)?.36:.67));
    if(sx+size<0||sx-size>w)return;
    const height=['core','item'].includes(e.type)?.45+Math.sin(state.elapsed*2+e.x)*.045:e.type==='exit'?.7:EYE_HEIGHT;
    const sy=this.horizon+(EYE_HEIGHT-height)*plane/z;
    // Clip each visible screen stripe against the wall depth buffer.
    c.save();c.beginPath();
    for(let x=Math.max(0,Math.floor((sx-size)/2)*2);x<Math.min(w,sx+size);x+=2)if(z<(this.depth[x]||0)+.12)c.rect(x,0,2,h);
    c.clip();
    if(e.type==='opponent'||e.type==='self'){
      drawHumanoid(c,e,p=>this.project(p,team,plane,w),{enemy:e.type==='opponent',firing:state.shots.some(s=>s.team===e.id&&s.life>.07)});
      if(e.type==='self'){c.restore();return;}
      const label=this.project({x:e.x,y:e.y,z:ROBOT_HEIGHT+.1},team,plane,w);
      c.fillStyle='#ffc3a1';c.font='10px monospace';c.textAlign='center';c.fillText(`ENEMY / UNIT ${e.id.toUpperCase()}`,label.x,label.y);c.restore();return;
    }
    c.translate(sx,sy);
    if(e.type==='item'||(e.type==='core'&&state.mode==='duel')){
      const info=ITEM_INFO[e.kind||'repair'];
      c.fillStyle='#101e25';c.strokeStyle=info.color;c.lineWidth=3;
      c.beginPath();c.moveTo(0,-size*.6);c.lineTo(size*.45,-size*.2);c.lineTo(size*.35,size*.4);c.lineTo(-size*.35,size*.4);c.lineTo(-size*.45,-size*.2);c.closePath();c.fill();c.stroke();
      c.fillStyle=info.color;c.font=`bold ${Math.max(12,size*.6)}px sans-serif`;c.textAlign='center';c.fillText(info.symbol,0,size*.13);
      this.label(info.name,size,info.color);
    }else if(e.type==='core'){
      c.shadowBlur=25;c.shadowColor='#d6fa70';c.fillStyle='#d6fa70';c.beginPath();c.moveTo(0,-size*.65);c.lineTo(size*.4,0);c.lineTo(0,size*.65);c.lineTo(-size*.4,0);c.closePath();c.fill();c.shadowBlur=0;c.strokeStyle='#f2ffd0';c.lineWidth=2;c.beginPath();c.moveTo(0,-size*.65);c.lineTo(0,size*.65);c.stroke();this.label(state.mode==='duel'?'REPAIR +30 HP':'ENERGY CORE',size,'#d6fa70');
    }else if(e.type==='enemy'){
      c.fillStyle=e.hit>0?'#fff1d9':'#ac514a';c.strokeStyle='#ffa994';c.lineWidth=2;
      c.beginPath();c.moveTo(-size*.4,-size*.25);c.lineTo(0,-size*.43);c.lineTo(size*.4,-size*.25);c.lineTo(size*.31,size*.24);c.lineTo(0,size*.4);c.lineTo(-size*.31,size*.24);c.closePath();c.fill();c.stroke();
      c.fillStyle='#241d23';c.fillRect(-size*.27,-size*.09,size*.54,size*.17);c.fillStyle='#ffb098';c.fillRect(-size*.16,-size*.025,size*.32,size*.05);this.label('HOSTILE',size,'#ffae98');
    }else{
      c.strokeStyle=state.collected===4?'#d6fa70':'#85b9b0';c.lineWidth=Math.max(2,size*.035);c.strokeRect(-size*.55,-size*.8,size*1.1,size*1.55);c.fillStyle='#d6fa7018';c.fillRect(-size*.55,-size*.8,size*1.1,size*1.55);this.label(state.collected===4?'EXIT / OPEN':'EXIT / NEED 4 CORES',size,'#d6fa70');
    }
    c.restore();
  }
  project(p,team,plane,w){
    const dx=p.x-team.x,dy=p.y-team.y,depth=dx*Math.cos(team.angle)+dy*Math.sin(team.angle);
    if(depth<.1)return null;
    return {x:w/2+(-dx*Math.sin(team.angle)+dy*Math.cos(team.angle))*plane/depth,y:this.horizon+(EYE_HEIGHT-p.z)*plane/depth,scale:plane/depth,depth};
  }
  drawHands(w,h,bob,firing,team){
    const c=this.ctx;
    for(const [side,sign] of [[.34,-1],[.72,1]]){
      const elbow={x:w*side,y:h*1.03},wrist={x:w*(.55+sign*.055),y:h*.84+bob+(firing?7:0)};
      const sway=team?emoteSway(team):0;
      elbow.x+=sway*w*.025;wrist.x+=sway*w*.018;
      if(sign<0&&team?.emote&&team.emote.kind!=='sway'){
        const salute=team.emote.kind==='salute',phase=(3-team.emote.life)*10;
        wrist.x=w*(salute?.36:.25+Math.sin(phase)*.035);wrist.y=h*(salute?.28:.43);
      }
      c.save();c.lineCap='round';c.strokeStyle='#1b2923';c.lineWidth=w*.06;c.beginPath();c.moveTo(elbow.x,elbow.y);c.lineTo(wrist.x,wrist.y);c.stroke();
      c.strokeStyle='#b6beaa';c.lineWidth=w*.043;c.stroke();
      c.fillStyle='#38493e';c.beginPath();c.arc(wrist.x,wrist.y,w*.027,0,Math.PI*2);c.fill();
      c.fillStyle='#dce0cb';c.beginPath();c.ellipse(wrist.x,wrist.y-h*.016,w*.021,h*.025,-sign*.5,0,Math.PI*2);c.fill();c.restore();
    }
  }
  bodyDirection(team,w,h){
    const c=this.ctx,delta=normalizeAngle(team.bodyAngle-team.angle),x=w-72,y=95;
    c.save();c.translate(x,y);c.strokeStyle='#d6fa7077';c.lineWidth=1;c.beginPath();c.arc(0,0,22,0,Math.PI*2);c.stroke();
    c.rotate(delta);c.fillStyle='#d6fa70';c.beginPath();c.moveTo(0,-17);c.lineTo(-6,8);c.lineTo(0,4);c.lineTo(6,8);c.closePath();c.fill();c.restore();
    c.fillStyle='#d6fa70';c.textAlign='center';c.font='9px monospace';c.fillText('W / BODY',x,y+33);c.textAlign='left';
  }
  bodyPreview(team,firing){
    const c=this.bodyCanvas.getContext('2d'),w=this.bodyCanvas.width,h=this.bodyCanvas.height;
    c.clearRect(0,0,w,h);c.fillStyle='#c7d2b51c';c.beginPath();c.ellipse(w/2,h-34,48,10,0,0,Math.PI*2);c.fill();
    const camera={x:team.x+1.8,y:team.y+2.6},angle=Math.atan2(-2.6,-1.8);
    const project=p=>{
      const dx=p.x-camera.x,dy=p.y-camera.y,depth=dx*Math.cos(angle)+dy*Math.sin(angle),scale=450/depth;
      return {x:w/2+(-dx*Math.sin(angle)+dy*Math.cos(angle))*scale,y:h*.51+(.68-p.z)*scale,depth,scale};
    };
    drawHumanoid(c,team,project,{firing});
    c.fillStyle='#a4b48d';c.font='11px monospace';c.textAlign='center';
    c.fillText(`NECK ${Math.round(normalizeAngle(team.angle-team.bodyAngle)*180/Math.PI)}°`,w/2,h-12);
  }
  label(text,size,color){const c=this.ctx;c.font=`${Math.max(9,Math.min(14,size*.12))}px monospace`;c.textAlign='center';c.fillStyle=color;c.fillText(text,0,-size*.9);c.textAlign='left';}
  minimap(state,team,w,h){
    const c=this.ctx,s=7.2,ox=22,oy=h-HEIGHT*s-53;
    c.fillStyle='#0a150de6';c.fillRect(ox-8,oy-22,WIDTH*s+16,HEIGHT*s+30);c.fillStyle='#bacfa0';c.font='8px monospace';c.fillText('STRUCTURAL MAP / N ↑',ox,oy-9);
    for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){c.fillStyle=MAP[y][x]==='1'?'#69785b':'#1d2a1c';c.fillRect(ox+x*s,oy+y*s,s-1,s-1);}
    for(const p of HAZARDS){c.fillStyle='#d56846';c.fillRect(ox+p.x*s,oy+p.y*s,s-1,s-1);}
    if(state.mode!=='duel'){c.fillStyle=state.collected===4?'#d6fa70':'#69a49a';c.fillRect(ox+16*s,oy+s,3*s,3*s);}
    for(const t of state.teams){if(t.id!==team.id)continue;c.save();c.translate(ox+t.x*s,oy+t.y*s);c.rotate(t.bodyAngle);c.fillStyle='#d6fa70';c.beginPath();c.moveTo(6,0);c.lineTo(-4,-3);c.lineTo(-4,3);c.closePath();c.fill();c.rotate(t.angle-t.bodyAngle);c.strokeStyle='#c8e8ff';c.beginPath();c.moveTo(0,0);c.lineTo(10,0);c.stroke();c.restore();}
    c.fillStyle='#afbc9f';c.font='8px sans-serif';c.fillText(state.mode==='duel'?'赤：危険な床 / 敵の位置は相棒へ':'赤：危険な床  /  右上：出口',ox,oy+HEIGHT*s+14);
  }
  seekerBadge(c,w,h,state){c.strokeStyle='#91afc24a';c.beginPath();c.arc(66,h-94,29,0,Math.PI*2);c.stroke();c.beginPath();c.arc(66,h-94,20,state.elapsed*.4,state.elapsed*.4+1.6);c.stroke();c.fillStyle='#91afc2';c.font='8px monospace';c.fillText('BIO SCAN',40,h-48);}
}
