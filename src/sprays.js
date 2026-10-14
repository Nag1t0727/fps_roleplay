// Vector paint projected onto its actual wall/floor plane, with wall occlusion.
const circle=(x,y,r,start=0,end=Math.PI*2,n=32)=>Array.from({length:n+1},(_,i)=>[x+Math.cos(start+(end-start)*i/n)*r,y+Math.sin(start+(end-start)*i/n)*r]);
const star=Array.from({length:11},(_,i)=>{const a=i*Math.PI/5-Math.PI/2,r=i%2?.42:.95;return [Math.cos(a)*r,Math.sin(a)*r];});
const shapes={
  link:[circle(-.33,0,.55),circle(.33,0,.55)],
  star:[star],
  smile:[circle(0,0,.95),circle(-.32,-.25,.06),circle(.32,-.25,.06),circle(0,.05,.5,.15,Math.PI-.15,16)],
};
export function drawSprays(renderer,sprays,team,plane,w,h){
  const c=renderer.ctx;
  c.save();c.lineCap='round';c.lineJoin='round';
  for(const s of sprays){
    if(s.surface==='wall'&&(team.x-s.x)*s.nx+(team.y-s.y)*s.ny<=0)continue;
    const project=([u,v])=>renderer.project(s.surface==='floor'?
      {x:s.x+u*.25,y:s.y+v*.25,z:s.z}:
      {x:s.x-s.ny*u*.25,y:s.y+s.nx*u*.25,z:s.z-v*.25},team,plane,w);
    for(const path of shapes[s.style]||[]){
      for(let i=1;i<path.length;i++){
        // Short segments prevent paint leaking around wall corners.
        const a=path[i-1],b=path[i],parts=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*16));
        let prev=project(a);
        for(let j=1;j<=parts;j++){
          const next=project([a[0]+(b[0]-a[0])*j/parts,a[1]+(b[1]-a[1])*j/parts]);
          const visible=p=>p&&p.x>=0&&p.x<w&&p.y>=0&&p.y<h&&p.depth<renderer.depth[Math.floor(p.x)]+.025;
          if(visible(prev)&&visible(next)){
            c.beginPath();c.moveTo(prev.x,prev.y);c.lineTo(next.x,next.y);
            c.lineWidth=Math.max(1,Math.min(12,(prev.scale+next.scale)*.009));
            c.strokeStyle=s.team==='a'?'#d6fa70':'#ff9879';c.stroke();
          }
          prev=next;
        }
      }
    }
  }
  c.restore();
}
