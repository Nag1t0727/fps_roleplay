import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.jpg':'image/jpeg'};
const server=createServer(async(req,res)=>{
  try{
    const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!path.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403).end();return;}
    if(path===resolve(root,'demo-capture')){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><canvas id="scene" width="1280" height="720"></canvas>');return;}
    const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream'}).end(data);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.on('console',message=>console.log(message.text()));
  page.on('pageerror',error=>console.error('Scene error:',error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/demo-capture`);
  const plans=[{name:"duel-demo",start:0,duration:12},{name:"duel-drone",start:0,duration:4},{name:"duel-low",start:4,duration:4},{name:"duel-eye",start:8,duration:4}];
  for(const plan of plans){
  console.log(`Recording ${plan.name}`);
  const result=await page.evaluate(async({start:offset,duration})=>{
    const {createDemo}=await import('/demo/scene.js');
    const canvas=document.querySelector('canvas'),draw=createDemo(canvas);
    const candidates=[['mp4','video/mp4;codecs=avc1.42001f'],['webm','video/webm;codecs=vp9']];
    const formats=candidates.filter(([,mime])=>MediaRecorder.isTypeSupported(mime));
    if(!formats.length)throw new Error('No supported video recorder');
    draw(offset+.5);const poster=canvas.toDataURL('image/jpeg',.88);
    const stream=canvas.captureStream(30);
    const recordings=formats.map(([extension,mimeType])=>{
      const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:4500000}),chunks=[];
      const complete=new Promise((resolve,reject)=>{
        recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
        recorder.onerror=event=>reject(new Error(event.error?.message||'Recording failed'));
        recorder.onstop=async()=>{
          const blob=new Blob(chunks,{type:mimeType});
          const data=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);});
          resolve({extension,mimeType,data});
        };
      });
      recorder.start();return {recorder,complete};
    });
    await new Promise((resolve,reject)=>{
      const start=performance.now();
      function frame(now){const t=(now-start)/1000;if(t>=duration){resolve();return;}try{draw(offset+t);}catch(error){reject(error);return;}requestAnimationFrame(frame);}
      requestAnimationFrame(frame);
    });
    recordings.forEach(({recorder})=>recorder.stop());
    const videos=await Promise.all(recordings.map(r=>r.complete));stream.getTracks().forEach(track=>track.stop());
    // Decode the actual recordings and check dimensions and representative frames.
    console.log("Recording complete, decoding");
    const checks=[];
    for(const video of videos){
      const element=document.createElement('video');element.muted=true;element.src=video.data;
      await new Promise((resolve,reject)=>{element.onloadeddata=resolve;element.onerror=()=>reject(new Error('Recorded movie could not be decoded'));});
      const seek=async time=>{element.currentTime=time;await new Promise(resolve=>element.onseeked=resolve);};
      await seek(Math.min(2.25,duration-.2));const sample=document.createElement('canvas');sample.width=1280;sample.height=720;
      sample.getContext('2d').drawImage(element,0,0);const frame=sample.toDataURL('image/jpeg',.85);
      await seek(duration-.3);
      checks.push({extension:video.extension,width:element.videoWidth,height:element.videoHeight,duration:Number.isFinite(element.duration)?element.duration:null,frame});
      element.removeAttribute('src');element.load();
    }
    return {videos,poster,checks};
  },plan);
  const output=resolve(root,'assets');await mkdir(output,{recursive:true});
  const save=async(name,data)=>{const bytes=Buffer.from(data.slice(data.indexOf(',')+1),'base64');await writeFile(resolve(output,name),bytes);return bytes.length;};
  for(const video of result.videos){const size=await save(`${plan.name}.${video.extension}`,video.data);console.log(`${plan.name}.${video.extension}: ${size} bytes`);}
  await save(`${plan.name}-poster.jpg`,result.poster);
  await mkdir(resolve(root,'test-results'),{recursive:true});
  for(const check of result.checks){
    await writeFile(resolve(root,`test-results/${plan.name}-${check.extension}-frame.jpg`),Buffer.from(check.frame.split(',')[1],'base64'));
    console.log(JSON.stringify({name:plan.name,extension:check.extension,width:check.width,height:check.height,duration:check.duration}));
  }
  }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
