import {MAP,HAZARDS,createState} from '../src/engine.js';
import {Renderer} from '../src/renderer.js';
import {humanoidPose,drawHumanoid} from '../src/humanoid.js';
export const DURATION=12;
export const SHOTS=[{name:'drone',label:'01 / DRONE',start:0},{name:'low',label:'02 / LOW ANGLE',start:4},{name:'eye',label:'03 / FIRST PERSON',start:8}];
const mix=(a,b,t)=>a+(b-a)*t,vec=(x,y,z)=>({x,y,z});
const sub=(a,b)=>vec(a.x-b.x,a.y-b.y,a.z-b.z),dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>vec(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);
const unit=a=>{const d=Math.hypot(a.x,a.y,a.z);return vec(a.x/d,a.y/d,a.z/d);};
const rand=n=>{const r=Math.sin(n*127.1+311.7)*43758.5453;return r-Math.floor(r);};
const wall=(x,y)=>MAP[y]?.[x]==='1';

// Three choreographed 3D camera shots, using the game's map and articulated models.
export function createDemo(canvas){
  const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  const state=createState(),hands=new Renderer(canvas),[a,b]=state.teams;
  const timesA=[.45,.85,1.8,2.2,3.25],timesB=[.65,1.3,2.05,2.85,3.55];
  return seconds=>{
    const t=Math.max(0,Math.min(seconds,DURATION-.00001)),shot=Math.floor(t/4),s=t%4,p=s/4;
    Object.assign(a,{x:6.4+.65*Math.sin(t*1.4),y:13.25+.4*Math.sin(t*2),gait:t*11,moveSpeed:1,pitch:0,hurt:0});
    Object.assign(b,{x:10.15+.55*Math.sin(t*1.7+1),y:12.9+.65*Math.cos(t*1.5),gait:t*13,moveSpeed:1,pitch:0,hurt:0});
    a.angle=Math.atan2(b.y-a.y,b.x-a.x);b.angle=Math.atan2(a.y-b.y,a.x-b.x);
    a.bodyAngle=a.angle+.2*Math.sin(t*2);b.bodyAngle=b.angle-.2*Math.cos(t*2);
    const ageA=Math.min(...timesA.filter(x=>x<=s).map(x=>s-x),99),ageB=Math.min(...timesB.filter(x=>x<=s).map(x=>s-x),99);
    const fireA=ageA<.11,fireB=ageB<.11;
    let camera,target,focal;
    if(shot===0){
      const angle=mix(1.1,2.15,p),r=mix(13,7,p);
      camera=vec(9+Math.cos(angle)*r,10+Math.sin(angle)*r,mix(14,7,p));target=vec(8.5,mix(8.5,12.7,p),.15);focal=w*.77;
    }else if(shot===1){
      camera=vec(mix(4.3,7.4,p),14.45-.14*Math.sin(s*1.6),.19+.035*Math.sin(s*4));target=vec(mix(8.3,10,p),12.95,1.08);focal=w*.65;
    }else{
      camera=vec(a.x,a.y,.98+Math.sin(t*11)*.025);target=vec(b.x,b.y+.16*Math.sin(s*4),.84+.045*Math.sin(s*3));focal=w*.73;
    }
    const forward=unit(sub(target,camera)),right=unit(cross(forward,vec(0,0,1))),up=cross(right,forward);
    const kick=shot===2&&ageA<.18?1-ageA/.18:0;
    const shake=(ageB<.22?1-ageB/.22:0)*2.8+(shot===1?.7:.25);
    const ox=w/2+Math.sin(t*53)*shake,oy=h/2+Math.cos(t*47)*shake+kick*8;
    const transform=p=>{const d=sub(p,camera);return vec(dot(d,right),dot(d,up),dot(d,forward));};
    const screen=p=>({x:ox+p.x*focal/p.z,y:oy-p.y*focal/p.z,depth:p.z,scale:focal/p.z});
    const project=p=>{const q=transform(p);return q.z>.08?screen(q):null;};
    const queue=[];
    const polygon=(vertices,fill,stroke)=>{
      const points=vertices.map(transform),clipped=[];
      for(let i=0;i<points.length;i++){
        const v=points[i],n=points[(i+1)%points.length],inside=v.z>=.08,next=n.z>=.08;
        if(inside)clipped.push(v);
        if(inside!==next){const k=(.08-v.z)/(n.z-v.z);clipped.push(vec(mix(v.x,n.x,k),mix(v.y,n.y,k),.08));}
      }
      if(clipped.length<3)return;
      queue.push({depth:clipped.reduce((sum,p)=>sum+p.z,0)/clipped.length,draw:()=>{c.beginPath();clipped.map(screen).forEach((v,i)=>i?c.lineTo(v.x,v.y):c.moveTo(v.x,v.y));c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=.65;c.stroke();}}});
    };
    const line=(from,to,color,width=1)=>{
      const u=project(from),v=project(to);if(!u||!v)return;
      queue.push({depth:(u.depth+v.depth)/2,draw:()=>{c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(u.x,u.y);c.lineTo(v.x,v.y);c.stroke();}});
    };
    const glow=(position,color,size,alpha=1)=>{
      const q=project(position);if(!q)return;
      queue.push({depth:q.depth-.03,draw:()=>{
        const radius=Math.min(w*.6,size*q.scale);c.save();c.globalAlpha=alpha;c.globalCompositeOperation='lighter';
        const g=c.createRadialGradient(q.x,q.y,0,q.x,q.y,radius);g.addColorStop(0,'#fff4d6');g.addColorStop(.12,color);g.addColorStop(1,'transparent');
        c.fillStyle=g;c.fillRect(q.x-radius,q.y-radius,radius*2,radius*2);c.restore();
      }});
    };
    const sky=c.createLinearGradient(0,0,w*.5,h);sky.addColorStop(0,'#09141e');sky.addColorStop(.6,'#1b333b');sky.addColorStop(1,'#24312b');c.fillStyle=sky;c.fillRect(0,0,w,h);
    for(let y=0;y<MAP.length;y++)for(let x=0;x<MAP[y].length;x++){
      if(!wall(x,y)){
        const hazard=HAZARDS.some(p=>p.x===x&&p.y===y);
        polygon([vec(x,y,0),vec(x+1,y,0),vec(x+1,y+1,0),vec(x,y+1,0)],hazard?'#733d2a':(x+y)%2?'#233332':'#283b3b','#4b676333');
        if(hazard)line(vec(x+.12,y+.2,.01),vec(x+.88,y+.8,.01),'#ff9d5688',2);
      }else{
        const z=1.8;polygon([vec(x,y,z),vec(x+1,y,z),vec(x+1,y+1,z),vec(x,y+1,z)],'#506566','#a8c5b344');
        const faces=[{dx:0,dy:-1,v:[vec(x,y,0),vec(x+1,y,0),vec(x+1,y,z),vec(x,y,z)],color:'#263d40'},
          {dx:1,dy:0,v:[vec(x+1,y,0),vec(x+1,y+1,0),vec(x+1,y+1,z),vec(x+1,y,z)],color:'#334a49'},
          {dx:0,dy:1,v:[vec(x+1,y+1,0),vec(x,y+1,0),vec(x,y+1,z),vec(x+1,y+1,z)],color:'#38514e'},
          {dx:-1,dy:0,v:[vec(x,y+1,0),vec(x,y,0),vec(x,y,z),vec(x,y+1,z)],color:'#1c3338'}];
        for(const face of faces)if(!wall(x+face.dx,y+face.dy)){
          polygon(face.v,face.color,'#789a8c33');const [v1,v2]=face.v;
          line({...v1,z:.18},{...v2,z:.18},'#90bb9977',1);line({...v1,z:1.6},{...v2,z:1.6},'#b0d8c155',1);
        }
      }
    }
    for(const robot of [a,b]){
      polygon(Array.from({length:18},(_,i)=>vec(robot.x+Math.cos(i/18*Math.PI*2)*.34,robot.y+Math.sin(i/18*Math.PI*2)*.3,.015)),'#030b0ca8');
      if(robot===a&&shot===2)continue;
      const depth=transform(vec(robot.x,robot.y,.65)).z;
      if(depth>.1)queue.push({depth,draw:()=>drawHumanoid(c,robot,project,{enemy:robot===b,firing:robot===a?fireA:fireB})});
    }
    const poseA=humanoidPose(a),poseB=humanoidPose(b);
    for(const [shooter,victim,pose,age,color] of [[a,b,poseA,ageA,'#ddff90'],[b,a,poseB,ageB,'#ff945a']]){
      if(age<.12){
        if(!(shooter===a&&shot===2))glow(pose.muzzle,color,.42,1-age/.18);
        const end=vec(victim.x,victim.y,.8);
        if(shot===2&&shooter===a){
          const aim=project(end);if(aim)queue.push({depth:.01,draw:()=>{c.strokeStyle='#efffb4aa';c.lineWidth=2;c.beginPath();c.moveTo(w*.61,h*.77);c.lineTo(aim.x,aim.y);c.stroke();}});
        }else line(pose.muzzle,end,color,shot===0?2:3);
      }
      if(age<.65){
        const hit=vec(victim.x,victim.y,.75);
        for(let i=0;i<18;i++){
          const angle=rand(i+shooter.x)*Math.PI*2,speed=.45+rand(i+4)*1.7;
          const point=vec(hit.x+Math.cos(angle)*age*speed,hit.y+Math.sin(angle)*age*speed,hit.z+age*(.7+rand(i+9)*2)-age*age*3.5);
          if(point.z<.02)continue;
          line(point,vec(point.x-Math.cos(angle)*.055,point.y-Math.sin(angle)*.055,point.z-.055),`rgba(255,${170+Math.floor(rand(i)*70)},110,${1-age/.65})`,1.8);
        }
        glow(hit,color,.55+age*.9,Math.max(0,.3-age*.6));
      }
    }
    queue.sort((a,b)=>b.depth-a.depth);for(const object of queue)object.draw();
    if(shot===2){
      hands.drawHands(w,h,Math.sin(t*11)*5+kick*10,fireA);
      c.save();c.translate(kick*3,kick*12);c.fillStyle='#405957';c.strokeStyle='#96b3a0';c.lineWidth=2;
      c.beginPath();c.moveTo(w*.54,h);c.lineTo(w*.55,h*.79);c.lineTo(w*.565,h*.68);c.lineTo(w*.62,h*.67);c.lineTo(w*.66,h*.78);c.lineTo(w*.69,h);c.closePath();c.fill();c.stroke();
      c.fillStyle='#101c22';c.fillRect(w*.57,h*.7,w*.04,h*.045);c.fillStyle='#d6fa70';c.fillRect(w*.582,h*.706,w*.016,3);
      if(fireA){const g=c.createRadialGradient(w*.595,h*.67,2,w*.595,h*.67,80);g.addColorStop(0,'#fffadf');g.addColorStop(.2,'#ffe99ecc');g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(w*.595-80,h*.67-80,160,160);}
      c.restore();c.strokeStyle='#deffb688';c.lineWidth=1;c.beginPath();c.moveTo(w/2-5,h/2);c.lineTo(w/2+5,h/2);c.moveTo(w/2,h/2-5);c.lineTo(w/2,h/2+5);c.stroke();
    }
    const vignette=c.createRadialGradient(w*.5,h*.46,h*.15,w*.5,h*.46,w*.65);vignette.addColorStop(0,'transparent');vignette.addColorStop(1,'#020910bd');c.fillStyle=vignette;c.fillRect(0,0,w,h);
    c.fillStyle='#040a0ee8';c.fillRect(0,0,w,h*.065);c.fillRect(0,h*.935,w,h*.065);
    c.font=`600 ${Math.round(w/90)}px monospace`;c.fillStyle='#ced8c5';c.fillText('SPLIT SIGNAL',w*.035,h*.041);
    c.textAlign='right';c.fillStyle='#d6fa70';c.fillText(SHOTS[shot].label,w*.965,h*.041);c.textAlign='left';
    c.fillStyle='#d6fa70';c.fillRect(w*.035,h*.967,w*.93*p,2);
  };
}
