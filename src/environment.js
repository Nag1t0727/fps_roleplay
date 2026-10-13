// Deterministic, locally generated materials. No image downloads during play.
function random(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
export class OutdoorEnvironment{
  constructor(width,height){
    const r=random(20261013);
    this.wall=canvas(256,256);const c=this.wall.getContext('2d'),im=c.createImageData(256,256);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){
      const i=(y*256+x)*4,n=(r()-.5)*25+Math.sin(x*.07+y*.015)*4+Math.sin(y*.027)*5;
      const stain=Math.max(0,Math.sin(x*.09+Math.sin(y*.012)))*Math.max(0,y-110)*.11;
      im.data[i]=153+n-stain;im.data[i+1]=153+n-stain*.7;im.data[i+2]=143+n-stain;im.data[i+3]=255;
    }
    c.putImageData(im,0,0);
    for(let y=38;y<256;y+=84)for(let x=38;x<256;x+=88){c.fillStyle='#32383170';c.beginPath();c.arc(x,y,2.5,0,7);c.fill();c.strokeStyle='#d9d8c05c';c.stroke();}
    c.fillStyle='#434d4144';c.fillRect(0,0,2,256);c.fillStyle='#fff8db42';c.fillRect(2,0,1,256);
    c.fillStyle='#5b60514d';c.fillRect(0,126,256,2);
    for(let i=0;i<9;i++){let x=r()*256,y=r()*256;c.strokeStyle='#41453d55';c.lineWidth=.65;c.beginPath();c.moveTo(x,y);for(let j=0;j<6;j++){x+=(r()-.5)*10;y+=r()*10;c.lineTo(x,y);}c.stroke();}
    for(let i=0;i<1600;i++){const y=220+r()*36;c.fillStyle=`rgba(53,73,35,${r()*.25})`;c.fillRect(r()*256,y,1+r()*8,1+r()*4);}
    this.ground=canvas(128,128);const g=this.ground.getContext('2d'),ground=g.createImageData(128,128);
    for(let i=0;i<128*128;i++){const n=(r()-.5)*32;ground.data[i*4]=94+n;ground.data[i*4+1]=96+n;ground.data[i*4+2]=82+n;ground.data[i*4+3]=255;}
    g.putImageData(ground,0,0);
    for(let i=0;i<55;i++){g.strokeStyle='#373d3655';g.beginPath();let x=r()*128,y=r()*128;g.moveTo(x,y);for(let j=0;j<5;j++){x+=r()*7;y+=(r()-.5)*7;g.lineTo(x,y);}g.stroke();}
    this.groundPixels=g.getImageData(0,0,128,128).data;
    this.trees=Array.from({length:4},(_,i)=>this.tree(i));this.forest=[];
    for(let ring=0;ring<3;ring++){
      const margin=3+ring*5;
      for(let x=-margin;x<width+margin;x+=1.4){this.forest.push({x:x+r(),y:-margin-r()*3,z:5+r()*4,kind:Math.floor(r()*4)});this.forest.push({x:x+r(),y:height+margin+r()*3,z:5+r()*5,kind:Math.floor(r()*4)});}
      for(let y=-margin;y<height+margin;y+=1.4){this.forest.push({x:-margin-r()*3,y:y+r(),z:5+r()*4,kind:Math.floor(r()*4)});this.forest.push({x:width+margin+r()*3,y:y+r(),z:5+r()*5,kind:Math.floor(r()*4)});}
    }
    this.floorCanvas=canvas(1,1);this.visibleTrees=[];this.forestPose={};
  }
  tree(index){
    const image=canvas(256,512),c=image.getContext('2d'),r=random(903+index*301);
    c.fillStyle='#4a4935';c.beginPath();c.moveTo(122,512);c.lineTo(128,30);c.lineTo(137,512);c.fill();
    c.fillStyle='#777461';c.fillRect(127,340,3,172);
    // Layer many irregular needle clusters rather than a flat triangle silhouette.
    for(let layer=0;layer<24;layer++){
      const y=42+layer*16,spread=8+layer*4.1;
      c.strokeStyle='#414b30';c.lineWidth=2;c.beginPath();c.moveTo(130,y-8);c.lineTo(130-spread,y+20);c.moveTo(130,y-8);c.lineTo(130+spread,y+20);c.stroke();
      for(let j=0;j<45;j++){
        const x=130+(r()*2-1)*spread,dy=r()*30,light=r();
        c.fillStyle=light>.7?'#65764b':light>.4?'#435b36':'#263f2d';
        c.beginPath();c.ellipse(x,y+dy,3+r()*10,2+r()*5,r(),0,7);c.fill();
      }
    }
    return image;
  }
  draw(c,team,w,h,plane,horizon,eye,upper){
    const sky=c.createLinearGradient(0,Math.min(0,horizon-h*.6),0,Math.max(1,horizon));
    sky.addColorStop(0,upper?'#80979f':'#667d87');sky.addColorStop(.65,'#bdc9c5');sky.addColorStop(1,'#e0dfcc');c.fillStyle=sky;c.fillRect(0,0,w,h);
    // Soft overcast cloud banks stay oriented in world space when turning.
    for(let i=0;i<7;i++){
      const angle=i*.92-team.angle,dx=Math.atan2(Math.sin(angle),Math.cos(angle));
      if(Math.abs(dx)>1.5)continue;
      const x=w/2+Math.tan(dx)*plane,y=horizon-h*(.3+(i%3)*.08),radius=w*.25;
      const cloud=c.createRadialGradient(x,y,0,x,y,radius);cloud.addColorStop(0,'#f9f5df38');cloud.addColorStop(1,'#f9f5df00');c.fillStyle=cloud;c.fillRect(x-radius,y-radius,radius*2,radius*2);
    }
    this.floor(c,team,w,h,plane,horizon,eye,upper);
    // Reuse projection records and sort only visible trees when the camera moves.
    const pose=this.forestPose;
    if(pose.x!==team.x||pose.y!==team.y||pose.angle!==team.angle||pose.pitch!==team.pitch||pose.w!==w||pose.h!==h){
      Object.assign(pose,{x:team.x,y:team.y,angle:team.angle,pitch:team.pitch,w,h});
      const cos=Math.cos(team.angle),sin=Math.sin(team.angle);this.visibleTrees.length=0;
      for(const tree of this.forest){
        const dx=tree.x-team.x,dy=tree.y-team.y,d=dx*cos+dy*sin;
        if(d<=.2)continue;
        const height=tree.z*plane/d,width=height*.5,x=w/2+(-dx*sin+dy*cos)*plane/d-width/2,y=horizon+(eye-tree.z)*plane/d;
        if(x+width<0||x>w||y>h||y+height<0)continue;
        Object.assign(tree,{d,sx:x,sy:y,sw:width,sh:height});this.visibleTrees.push(tree);
      }
      this.visibleTrees.sort((a,b)=>b.d-a.d);
    }
    for(const t of this.visibleTrees){
      c.globalAlpha=Math.max(.35,1-t.d/100);c.drawImage(this.trees[t.kind],t.sx,t.sy,t.sw,t.sh);
    }
    c.globalAlpha=1;
  }
  floor(c,team,w,h,plane,horizon,eye,upper){
    if(!upper){
      // The lower role cannot see ground details; no world-space pixel work needed.
      const top=Math.max(0,horizon);if(top>=h)return;
      const floor=c.createLinearGradient(0,top,0,h);floor.addColorStop(0,'#586970');floor.addColorStop(1,'#2a3940');
      c.fillStyle=floor;c.fillRect(0,top,w,h-top);return;
    }
    const target=this.floorCanvas,sw=Math.ceil(w/4),sh=Math.ceil(h/4);
    if(target.width!==sw||target.height!==sh){target.width=sw;target.height=sh;this.floorImage=target.getContext('2d').createImageData(sw,sh);}
    const image=this.floorImage,pixels=image.data,tex=this.groundPixels,cos=Math.cos(team.angle),sin=Math.sin(team.angle);
    pixels.fill(0);
    for(let y=Math.max(0,Math.floor(horizon/4)+1);y<sh;y++){
      const depth=eye*plane/(y*4-horizon),fog=Math.min(.85,depth/45);
      for(let x=0;x<sw;x++){
        const side=(x*4-w/2)*depth/plane,wx=team.x+cos*depth-sin*side,wy=team.y+sin*depth+cos*side;
        const tx=((Math.floor(wx*60)%128)+128)%128,ty=((Math.floor(wy*60)%128)+128)%128,src=(ty*128+tx)*4,i=(y*sw+x)*4;
        pixels[i]=tex[src]*(1-fog)+151*fog;pixels[i+1]=tex[src+1]*(1-fog)+162*fog;pixels[i+2]=tex[src+2]*(1-fog)+143*fog;
        pixels[i+3]=255;
      }
    }
    target.getContext('2d').putImageData(image,0,0);c.drawImage(target,0,0,w,h);
  }
}
