import {test,expect} from './mqtt-fixture.js';

test('lower camera predicts instantly and stays smooth with delayed, jittered MQTT snapshots',async({browser})=>{
  test.setTimeout(90000);
  const contexts=[],pages=[];
  try{
    for(let i=0;i<4;i++){
      const context=await browser.newContext();contexts.push(context);
      if(i===2){
        // Delay actual MQTT input/snapshot handling, not the rendering clock.
        await context.route('**/src/network.js*',async route=>{
          const response=await route.fetch();let body=await response.text();
          body=body.replace('  receive(bytes){',`  receive(bytes){
            const text=bytes.toString();
            if(text.includes('"kind":"state"')){
              const n=(this.testArrival=(this.testArrival||0)+1);
              setTimeout(()=>this.receiveDelayed(bytes),[70,110,90,140][n%4]);return;
            }
            this.receiveDelayed(bytes);
          }
          receiveDelayed(bytes){`);
          // Add a 180 ms outbound delay: visual movement must not wait for the host.
          body=body.replace('    if(this.closed)return;\n    const payload=', `    if(kind==='input'&&!data.testDelayed){setTimeout(()=>this.publish(kind,{...data,testDelayed:true},to),180);return;}
    if(this.closed)return;
    const payload=`);
          await route.fulfill({response,body});
        });
        await context.route('**/src/renderer.js*',async route=>{
          const response=await route.fetch();const body=(await response.text()).replace('  draw(state,slot){',`  draw(state,slot){
            const t=state.teams.find(t=>t.id===slot[0]);
            (window.renderSamples??=[]).push({at:performance.now(),x:t.x,y:t.y,angle:t.angle});
            if(window.renderSamples.length>400)window.renderSamples.shift();`);
          await route.fulfill({response,body});
        });
      }
      const page=await context.newPage();pages.push(page);await page.goto('/');
    }
    const [host,,lower]=pages;
    await host.locator('#create-room').click();await expect(host.locator('#room-panel')).toBeVisible();
    const code=await host.locator('#room-code').textContent();
    for(const page of pages.slice(1)){await page.locator('#room-input').fill(code);await page.locator('#join-form button').click();await expect(page.locator('#room-panel')).toBeVisible();}
    await host.locator('#start-game').click();await expect(lower.locator('#game')).toBeVisible();
    await expect(lower.locator('#role-title')).toHaveText('SEEKER / 下半身');
    await lower.waitForTimeout(500);await lower.locator('#viewport').focus();
    const before=await lower.evaluate(()=>{window.renderSamples=[];return performance.now();});
    await lower.keyboard.down('w');await lower.waitForTimeout(1200);await lower.keyboard.up('w');
    const samples=await lower.evaluate(()=>window.renderSamples);
    const first=samples[0],moved=samples.find(s=>Math.hypot(s.x-first.x,s.y-first.y)>.015);
    expect(moved.at-before).toBeLessThan(170);
    const steps=samples.slice(1).map((s,i)=>Math.hypot(s.x-samples[i].x,s.y-samples[i].y));
    const moving=steps.filter(d=>d>.001).length/steps.length;
    expect(moving).toBeGreaterThan(.8);
    expect(Math.max(...steps)).toBeLessThan(.18);
    console.log(JSON.stringify({firstMovementMs:moved.at-before,movingFrameRatio:moving,largestPositionStep:Math.max(...steps)}));
    await lower.waitForTimeout(800);
    // Pause the match: local prediction must stop despite held movement.
    await pages[3].getByRole('button',{name:'ロビーへ',exact:true}).click();
    await expect(lower.locator('#signal')).toContainText('接続待ち');
    await lower.keyboard.down('w');await lower.waitForTimeout(300);
    const paused=await lower.evaluate(()=>window.renderSamples.at(-1));
    await lower.waitForTimeout(300);const after=await lower.evaluate(()=>window.renderSamples.at(-1));
    await lower.keyboard.up('w');expect(Math.hypot(after.x-paused.x,after.y-paused.y)).toBeLessThan(.001);
  }finally{for(const context of contexts)await context.close();}
});
