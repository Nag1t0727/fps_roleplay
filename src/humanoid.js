// Articulated world-space mannequin. z is height; pelvis and head have independent yaw.
export function humanoidPose(team){
  const yaw=team.bodyAngle,walk=team.moveSpeed||0,phase=team.gait||0;
  const swing=Math.sin(phase)*walk,bob=Math.abs(Math.sin(phase))*walk*.015;
  const local=(side,forward,z)=>({x:team.x-Math.sin(yaw)*side+Math.cos(yaw)*forward,y:team.y+Math.cos(yaw)*side+Math.sin(yaw)*forward,z:z+bob});
  const pose={pelvis:local(0,0,.59),chest:local(0,0,.84),neck:local(0,0,1.045)};
  for(const [name,sign] of [['left',-1],['right',1]]){
    const stride=swing*sign;
    pose[`${name}Hip`]=local(sign*.115,0,.58);
    pose[`${name}Knee`]=local(sign*.12,stride*.11+.025,.32+Math.max(0,stride)*.025);
    pose[`${name}Ankle`]=local(sign*.12,stride*.19,.075+Math.max(0,stride)*.10);
    pose[`${name}Toe`]=local(sign*.12,stride*.19+.09,.05+Math.max(0,stride)*.10);
    pose[`${name}Shoulder`]=local(sign*.215,0,.96);
    pose[`${name}Elbow`]=local(sign*.235,-stride*.10,.75);
    pose[`${name}Hand`]=local(sign*.23,-stride*.18,.57);
  }
  const pitch=team.pitch||0,look={x:Math.cos(team.angle)*Math.cos(pitch),y:Math.sin(team.angle)*Math.cos(pitch),z:Math.sin(pitch)};
  const headRight={x:-Math.sin(team.angle),y:Math.cos(team.angle),z:0};
  const headUp={x:-Math.cos(team.angle)*Math.sin(pitch),y:-Math.sin(team.angle)*Math.sin(pitch),z:Math.cos(pitch)};
  pose.head={x:pose.neck.x+headUp.x*.115,y:pose.neck.y+headUp.y*.115,z:pose.neck.z+headUp.z*.115};
  pose.look=look;pose.headRight=headRight;pose.headUp=headUp;
  // The shooting arm follows the neck's aim, while walking animates the opposite arm.
  const shoulder=pose.rightShoulder;
  pose.rightElbow={x:shoulder.x+look.x*.13,y:shoulder.y+look.y*.13,z:shoulder.z-.12+look.z*.10};
  pose.rightHand={x:shoulder.x+look.x*.34,y:shoulder.y+look.y*.34,z:shoulder.z+look.z*.34};
  pose.muzzle={x:pose.rightHand.x+look.x*.19,y:pose.rightHand.y+look.y*.19,z:pose.rightHand.z+look.z*.19};
  pose.local=local;
  return pose;
}

export function drawHumanoid(ctx,team,project,{enemy=false,firing=false}={}){
  const p=humanoidPose(team),parts=[];
  const shell=team.hurt>0?'#fff0df':enemy?'#d3a18b':'#d9dcc9';
  const shade=enemy?'#946d62':'#929d8e',joint='#283530',accent=enemy?'#ff9879':'#d6fa70';
  const add=(points,paint)=>{
    const screen=points.map(project);if(screen.some(p=>!p||p.depth<.10))return;
    parts.push({depth:screen.reduce((sum,p)=>sum+p.depth,0)/screen.length,paint:()=>paint(screen)});
  };
  const bone=(a,b,r,color)=>add([a,b],([s,t])=>{
    const width=Math.max(1,r*(s.scale+t.scale));
    ctx.lineCap='round';ctx.strokeStyle='#15221e';ctx.lineWidth=width+2;ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(t.x,t.y);ctx.stroke();
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
    ctx.strokeStyle='#ffffff20';ctx.lineWidth=Math.max(1,width*.15);ctx.stroke();
  });
  const orb=(a,r,color,stretch=1)=>add([a],([s])=>{
    const radius=Math.max(.5,r*s.scale);
    ctx.fillStyle=color;ctx.strokeStyle='#15221e';ctx.lineWidth=1;
    ctx.beginPath();ctx.ellipse(s.x,s.y,radius,radius*stretch,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle='#ffffff25';ctx.beginPath();ctx.ellipse(s.x-radius*.23,s.y-radius*.25,radius*.32,radius*.22,0,0,Math.PI*2);ctx.fill();
  });
  const polygon=(points,color)=>add(points,screen=>{
    ctx.fillStyle=color;ctx.strokeStyle='#24342c';ctx.lineWidth=1;ctx.beginPath();screen.forEach((s,i)=>i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y));ctx.closePath();ctx.fill();ctx.stroke();
  });
  // Tapered torso, front and back faces keep the body's heading legible.
  for(const side of [-1,1]){
    polygon([p.local(-.18,side*.09,.97),p.local(.18,side*.09,.97),p.local(.12,side*.075,.69),p.local(-.12,side*.075,.69)],side===1?shell:shade);
    polygon([p.local(side*.18,-.09,.97),p.local(side*.18,.09,.97),p.local(side*.12,.075,.69),p.local(side*.12,-.075,.69)],shade);
  }
  polygon([p.local(-.18,-.09,.97),p.local(.18,-.09,.97),p.local(.18,.09,.97),p.local(-.18,.09,.97)],shell);
  bone(p.local(0,0,.64),p.local(0,0,.74),.09,joint);
  bone(p.leftHip,p.rightHip,.08,shade);
  polygon([p.local(-.045,.096,.9),p.local(.045,.096,.9),p.local(.045,.096,.81),p.local(-.045,.096,.81)],accent);
  for(const side of ['left','right']){
    bone(p[`${side}Hip`],p[`${side}Knee`],.065,shell);
    bone(p[`${side}Knee`],p[`${side}Ankle`],.052,shell);
    orb(p[`${side}Knee`],.057,joint);orb(p[`${side}Hip`],.06,joint);
    bone(p[`${side}Ankle`],p[`${side}Toe`],.055,shade);
    orb(p[`${side}Shoulder`],.07,shell);
    bone(p[`${side}Shoulder`],p[`${side}Elbow`],.048,shell);
    orb(p[`${side}Elbow`],.044,joint);
    bone(p[`${side}Elbow`],p[`${side}Hand`],.04,shell);orb(p[`${side}Hand`],.047,shade,1.2);
  }
  bone(p.neck,p.head,.037,joint);orb(p.head,.102,shell,1.2);
  const face=(side,up)=>({x:p.head.x+p.look.x*.099+p.headRight.x*side+p.headUp.x*up,y:p.head.y+p.look.y*.099+p.headRight.y*side+p.headUp.y*up,z:p.head.z+p.look.z*.099+p.headUp.z*up});
  // Only draw the face on the near side of the skull, rather than through its back.
  if(project(face(0,0))?.depth<project(p.head)?.depth){
    polygon([face(-.074,.036),face(.074,.036),face(.074,-.018),face(-.074,-.018)],joint);
    bone(face(-.044,.012),face(.044,.012),.007,accent);
  }
  for(const side of [-1,1])orb({x:p.head.x+p.headRight.x*.101*side,y:p.head.y+p.headRight.y*.101*side,z:p.head.z},.024,joint);
  bone(p.rightHand,p.muzzle,.025,joint);
  if(firing)orb(p.muzzle,.065,'#efffb2');
  parts.sort((a,b)=>b.depth-a.depth);ctx.save();for(const part of parts)part.paint();ctx.restore();
}
