import {test,expect} from './mqtt-fixture.js';

test('cosmetics: four players share emotes and floor sprays with cooldowns',async({browser})=>{
  const contexts=[],pages=[],errors=[];
  try{
    for(let i=0;i<4;i++){
      const context=await browser.newContext();contexts.push(context);const p=await context.newPage();pages.push(p);
      p.on('pageerror',e=>errors.push(e.message));await p.goto('/',{waitUntil:'domcontentloaded'});
    }
    await pages[0].locator('#create-room').click();await expect(pages[0].locator('#room-panel')).toBeVisible();
    const code=await pages[0].locator('#room-code').textContent();
    for(const p of pages.slice(1)){await p.locator('#room-input').fill(code);await p.locator('#join-form button').click();await expect(p.locator('#room-panel')).toBeVisible();}
    await pages[0].locator('#start-game').click();for(const p of pages)await expect(p.locator('#game')).toBeVisible();
    await pages[1].locator('#viewport').focus();await pages[1].keyboard.press('b');
    await expect(pages[0].locator('#cosmetic-status')).toContainText('手を振っています');
    for(const p of pages.slice(0,2))await expect(p.locator('#viewport')).toHaveAttribute('data-perspective','third-person');
    for(const p of pages.slice(2))await expect(p.locator('#viewport')).toHaveAttribute('data-perspective','first-person');
    await pages[0].locator('#viewport').screenshot({path:'test-results/emote-third-person.png'});
    await expect(pages[0].locator('#emote-salute')).toBeDisabled();await expect(pages[2].locator('#emote-salute')).toBeEnabled();
    await pages[1].keyboard.down('ArrowDown');await pages[1].waitForTimeout(550);await pages[1].keyboard.up('ArrowDown');
    await pages[1].locator('#spray-style').selectOption('smile');await pages[1].keyboard.press('t');
    for(const p of pages)await expect(p.locator('#cosmetic-status')).toContainText('設置 1/24',{timeout:8000});
    await expect(pages[0].locator('#spray-button')).toBeDisabled();await expect(pages[2].locator('#spray-button')).toBeEnabled();
    await pages[0].screenshot({path:'test-results/cosmetics-lower.png',fullPage:true});
    await pages[1].screenshot({path:'test-results/cosmetics-upper.png',fullPage:true});
    for(const p of pages.slice(0,2))await expect(p.locator('#viewport')).toHaveAttribute('data-perspective','first-person');
    await expect(pages[0].locator('#emote-salute')).toBeEnabled();await pages[0].locator('#emote-salute').click();
    await expect(pages[1].locator('#cosmetic-status')).toContainText('敬礼中');
    await pages[2].locator('#viewport').focus();await pages[2].keyboard.press('m');
    await expect(pages[3].locator('#cosmetic-status')).toContainText('横揺れ中');
    await expect(pages[3].locator('#emote-sway')).toBeDisabled();
    for(const p of pages.slice(2))await expect(p.locator('#viewport')).toHaveAttribute('data-perspective','third-person');
    expect(errors).toEqual([]);
  }finally{for(const c of contexts)await c.close();}
});

test('spray render: paint follows surfaces and stays behind intervening walls',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{
    const {createState,placeSpray}=await import('/src/engine.js?v=cosmetics-3');
    const {Renderer}=await import('/src/renderer.js?v=cosmetics-3');
    const {drawSprays}=await import('/src/sprays.js?v=cosmetics-3');
    const s=createState(),t=s.teams[0];Object.assign(t,{x:2.5,y:2.5,angle:-Math.PI/2,pitch:0});
    placeSpray(s,'a-upper','star');const wall=s.sprays[0];
    t.sprayCooldown=0;t.pitch=-.9;placeSpray(s,'a-upper','smile');
    const canvas=document.querySelector('#viewport');canvas.width=800;canvas.height=500;
    const r=new Renderer(canvas),count=()=>{const data=r.ctx.getImageData(0,0,800,500).data;let n=0;for(let i=0;i<data.length;i+=4)if(data[i]>130&&data[i+1]>160&&data[i+2]<140)n++;return n;};
    r.draw(s,'a-lower');
    const paint=marks=>{canvas.width=800;drawSprays(r,marks,t,800*.72,800,500);return count();};
    const baseline=paint([]),painted=paint(s.sprays),hidden=paint([{...wall,y:-1}]);
    r.draw(s,'a-lower');document.querySelector('#lobby').hidden=true;document.querySelector('#game').hidden=false;
    return {baseline,painted,hidden};
  });
  expect(result.painted).toBeGreaterThan(result.baseline+100);expect(result.hidden).toBe(result.baseline);
  await page.locator('#viewport').screenshot({path:'test-results/cosmetics-surfaces.png'});
});
