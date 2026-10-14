import {advanceMovement,canStand,normalizeAngle} from './engine.js?v=cosmetics-3';
const lerp=(a,b,t)=>a+(b-a)*t;
const angleLerp=(a,b,t)=>normalizeAngle(a+normalizeAngle(b-a)*t);
const copyPose=t=>({...t});

// Only presentation is predicted. HP, pickups, hits and round results stay authoritative.
export class MotionView{
  constructor({delay=100,maxPrediction=300}={}){this.delay=delay;this.maxPrediction=maxPrediction;this.clear();}
  clear(){this.samples=[];this.history=[];this.key='';this.predicted=null;this.errorX=0;this.errorY=0;this.lastReceived=0;this.currentSeq=0;this.commandTime=0;this.offset=Infinity;}
  receive(state,meta,slot,now){
    const key=`${meta.epoch}:${state.round}:${state.status}:${slot}`;
    const team=state.teams.find(t=>t.id===slot[0]);
    const old=this.latest?.teams.find(t=>t.id===slot[0]);
    const reset=key!==this.key||!old||Math.hypot(team.x-old.x,team.y-old.y)>2;
    if(reset){this.clear();this.key=key;}
    const at=Number.isFinite(meta.at)?meta.at:now;
    this.offset=Math.min(this.offset,now-at);this.lastReceived=now;this.latest=state;this.slot=slot;
    this.samples.push({at,teams:state.teams.map(copyPose)});if(this.samples.length>32)this.samples.shift();
    if(!slot.endsWith('lower'))return;
    const ack=meta.acks?.[slot]||{seq:0,elapsed:0};
    const before=this.predicted?{x:this.predicted.x+this.errorX,y:this.predicted.y+this.errorY}:null;
    this.history=this.history.filter(e=>e.seq>ack.seq||(e.seq===ack.seq&&e.start+e.dt>ack.elapsed+1e-8));
    this.predicted=copyPose(team);
    for(const e of this.history){
      const dt=e.seq===ack.seq?Math.max(0,e.dt-Math.max(0,ack.elapsed-e.start)):e.dt;
      this.predicted.bodyAngle=e.angle;advanceMovement(this.predicted,e.input,dt);
      this.predicted.boost=Math.max(0,this.predicted.boost-dt);
    }
    if(before&&!reset){
      this.errorX=before.x-this.predicted.x;this.errorY=before.y-this.predicted.y;
      // Large corrections / spawn changes must not glide through walls.
      if(Math.hypot(this.errorX,this.errorY)>1.2){this.errorX=0;this.errorY=0;}
    }else{this.errorX=0;this.errorY=0;}
  }
  stopPrediction(state,slot){
    this.history=[];this.errorX=0;this.errorY=0;
    this.predicted=copyPose(state.teams.find(t=>t.id===slot[0]));
  }
  sample(state,slot,now,dt,input,inputSeq,active=true){
    if(!this.samples.length||slot!==this.slot)return state;
    const target=now-this.offset-this.delay;
    let left=this.samples[0],right=left;
    for(const sample of this.samples){right=sample;if(sample.at>=target)break;left=sample;}
    const t=right.at>left.at?Math.max(0,Math.min(1,(target-left.at)/(right.at-left.at))):0;
    const teams=state.teams.map((team,i)=>{
      const a=left.teams[i],b=right.teams[i],view={...team};
      for(const field of ['x','y','pitch','moveSpeed'])view[field]=lerp(a[field],b[field],t);
      for(const field of ['angle','bodyAngle','gait'])view[field]=angleLerp(a[field],b[field],t);
      if(!canStand(view.x,view.y)){view.x=b.x;view.y=b.y;}
      if(team.emote)view.emote={...team.emote,life:Math.max(0,team.emote.life-Math.max(0,now-this.lastReceived)/1000)};
      return view;
    });
    const mine=teams.find(t=>t.id===slot[0]);
    if(slot.endsWith('lower')&&this.predicted){
      const allowed=active&&state.status==='playing'&&mine.hp>0&&now-this.lastReceived<=this.maxPrediction;
      if(!allowed){
        if(this.history.length)this.stopPrediction(state,slot);
        // Freeze at the host position during a pause or prolonged outage.
        mine.x=this.predicted.x;mine.y=this.predicted.y;
      }else{
        if(inputSeq!==this.currentSeq){this.currentSeq=inputSeq;this.commandTime=0;}
        const command={seq:inputSeq,start:this.commandTime,dt,input:{forward:input.forward,strafe:input.strafe},angle:mine.angle};
        this.commandTime+=dt;this.history.push(command);
        // Bound history even when packets arrive but no input is acknowledged.
        while(this.history.length>120)this.history.shift();
        this.predicted.bodyAngle=mine.angle;advanceMovement(this.predicted,input,dt);
        this.predicted.boost=Math.max(0,this.predicted.boost-dt);
        const decay=Math.exp(-dt*18);this.errorX*=decay;this.errorY*=decay;
        const x=this.predicted.x+this.errorX,y=this.predicted.y+this.errorY;
        if(!canStand(x,y)){this.errorX=0;this.errorY=0;}
        mine.x=this.predicted.x+this.errorX;mine.y=this.predicted.y+this.errorY;
        mine.gait=this.predicted.gait;mine.moveSpeed=this.predicted.moveSpeed;
      }
    }
    return {...state,teams};
  }
}

// A host's lower-body camera also receives upper-body mouse deltas in packets.
export class HostCamera{
  clear(){this.pose=null;this.key='';}
  sample(state,slot,dt){
    if(!slot.endsWith('lower'))return state;
    const team=state.teams.find(t=>t.id===slot[0]),key=`${state.round}:${state.status}:${slot}`;
    if(!this.pose||this.key!==key||Math.hypot(team.x-this.pose.x,team.y-this.pose.y)>2){this.pose={...team};this.key=key;}
    const blend=1-Math.exp(-dt*25);
    this.pose.angle=angleLerp(this.pose.angle,team.angle,blend);this.pose.pitch=lerp(this.pose.pitch,team.pitch,blend);
    this.pose.x=team.x;this.pose.y=team.y;
    return {...state,teams:state.teams.map(t=>t===team?{...t,angle:this.pose.angle,bodyAngle:this.pose.angle,pitch:this.pose.pitch}:t)};
  }
}
