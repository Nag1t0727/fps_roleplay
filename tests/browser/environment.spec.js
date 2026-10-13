import {test,expect} from '@playwright/test';
test('forest concrete field renders both role views and extreme pitch without errors',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {Renderer}=await import('/src/renderer.js'),{createState}=await import('/src/engine.js');
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=800;canvas.id='environment-preview';
    document.querySelector('#lobby').hidden=true;document.querySelector('.site-header').hidden=true;document.body.append(canvas);
    const renderer=new Renderer(canvas),state=createState();Object.assign(state.teams[0],{x:8.5,y:13.5,angle:-1.6,bodyAngle:-1.6,pitch:0});
    const start=performance.now();for(const pitch of [-1.04,1.04,0]){state.teams[0].pitch=pitch;renderer.draw(state,'a-upper');renderer.draw(state,'a-lower');}
    renderer.draw(state,'a-upper');window.field={renderer,state};return {ms:performance.now()-start};
  });
  await page.locator('#environment-preview').screenshot({path:'test-results/forest-upper.png'});
  await page.evaluate(()=>field.renderer.draw(field.state,'a-lower'));
  await page.locator('#environment-preview').screenshot({path:'test-results/forest-lower.png'});
  expect(errors).toEqual([]);console.log('Seven outdoor frames (ms):',result.ms);
});
