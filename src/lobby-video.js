const lobby=document.getElementById('lobby');
const video=document.getElementById('lobby-video');
const toggle=document.getElementById('lobby-video-toggle');
const status=document.getElementById('lobby-video-status');
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let enabled=!reducedMotion.matches;
video.muted=true;

async function syncPlayback(){
  if(!enabled||lobby.hidden||document.hidden){video.pause();return;}
  try{await video.play();status.textContent='';}
  catch{status.textContent='背景は静止画で表示中です。再生ボタンから動画を開始できます。';}
  // A pending play request may finish after the lobby has been hidden.
  if(!enabled||lobby.hidden||document.hidden)video.pause();
}
toggle.addEventListener('click',()=>{enabled=video.paused;syncPlayback();});
video.addEventListener('play',()=>{toggle.textContent='背景動画を一時停止';});
video.addEventListener('pause',()=>{toggle.textContent='背景動画を再生';});
video.addEventListener('error',()=>{status.textContent='動画を読み込めないため、背景画像を表示しています。';});
document.addEventListener('visibilitychange',syncPlayback);
new MutationObserver(syncPlayback).observe(lobby,{attributes:true,attributeFilter:['hidden']});
reducedMotion.addEventListener('change',()=>{enabled=!reducedMotion.matches;syncPlayback();});
syncPlayback();
