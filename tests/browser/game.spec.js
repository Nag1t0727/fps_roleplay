import {test,expect} from '@playwright/test';

test('practice: movement, role separation, turning, signals, help and return to lobby',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:/ONE BODY/})).toBeVisible();
  await page.screenshot({path:'test-results/lobby.png',fullPage:true});
  await page.getByRole('button',{name:'ひとりで練習する'}).click();
  await expect(page.locator('#role-title')).toHaveText('SEEKER / 下半身');
  const before=await page.locator('#location').textContent();
  await page.keyboard.down('w');await page.waitForTimeout(400);await page.keyboard.up('w');
  await expect(page.locator('#location')).not.toHaveText(before);
  const lowerView=await page.locator('#compass').textContent(),bodyBefore=await page.locator('#body-heading').textContent();
  await page.keyboard.down('c');await page.waitForTimeout(300);await page.keyboard.up('c');
  await expect(page.locator('#body-heading')).not.toHaveText(bodyBefore);
  await expect(page.locator('#compass')).toHaveText(lowerView);
  await page.screenshot({path:'test-results/seeker.png'});
  await page.keyboard.press('Tab');await expect(page.locator('#role-title')).toHaveText('ARCHITECT / 上半身');
  const position=await page.locator('#location').textContent();
  await page.keyboard.down('w');await page.waitForTimeout(250);await page.keyboard.up('w');
  await expect(page.locator('#location')).toHaveText(position);
  const angle=await page.locator('#compass').textContent();
  await page.keyboard.down('ArrowRight');await page.waitForTimeout(300);await page.keyboard.up('ArrowRight');
  await expect(page.locator('#compass')).not.toHaveText(angle);
  const heading=await page.locator('#body-heading').textContent();
  await page.keyboard.down('ArrowUp');await page.waitForTimeout(300);await page.keyboard.up('ArrowUp');
  await expect(page.locator('#compass')).not.toContainText('/ P 0°');
  await expect(page.locator('#body-heading')).toHaveText(heading);
  await expect(page.locator('#body-preview')).toBeVisible();
  await page.keyboard.press('q');await expect(page.locator('#signal')).toContainText('進んで大丈夫');
  await page.keyboard.press('Space');await page.screenshot({path:'test-results/architect.png'});
  await page.getByRole('button',{name:'操作説明',exact:true}).click();await expect(page.locator('#help-dialog')).toBeVisible();
  await page.getByRole('button',{name:'了解',exact:true}).click();await page.getByRole('button',{name:'ロビーへ',exact:true}).click();
  await expect(page.locator('#lobby')).toBeVisible();expect(errors).toEqual([]);
});

test('mobile landing page fits viewport and practice remains accessible',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({path:'test-results/mobile.png',fullPage:true});
  await page.getByRole('button',{name:'ひとりで練習する'}).click();
  await expect(page.locator('#viewport')).toBeVisible();
});

test('real PeerJS: four browsers connect, role input synchronizes, capacity and reconnect work',async({browser})=>{
  test.setTimeout(150000);
  const contexts=[],pages=[],errors=[];
  try{
    for(let i=0;i<5;i++){
      const context=await browser.newContext();contexts.push(context);const page=await context.newPage();pages.push(page);
      page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.locator('#player-name').fill(`Pilot ${i+1}`);
    }
    const host=pages[0];await host.locator('#create-room').click();await expect(host.locator('#room-panel')).toBeVisible({timeout:25000});
    const code=await host.locator('#room-code').textContent();
    for(let i=1;i<4;i++){
      await pages[i].locator('#room-input').fill(code);await pages[i].locator('#join-form button').click();
      await expect(pages[i].locator('#room-panel')).toBeVisible({timeout:25000});
    }
    await expect(host.locator('#start-game')).toBeEnabled();
    await pages[4].locator('#room-input').fill(code);await pages[4].locator('#join-form button').click();
    await expect(pages[4].locator('#connection-status')).toContainText('満員',{timeout:25000});
    await host.locator('#start-game').click();
    for(let i=0;i<4;i++)await expect(pages[i].locator('#game')).toBeVisible();
    for(let i=0;i<4;i++)await expect(pages[i].locator('#round-label')).toHaveText('ROUND 1 / 3');
    await expect(pages[1].locator('#role-title')).toHaveText('ARCHITECT / 上半身');
    const initial=await host.locator('#location').textContent();
    await host.locator('#viewport').focus();await host.keyboard.down('w');await host.waitForTimeout(500);await host.keyboard.up('w');
    await expect(host.locator('#location')).not.toHaveText(initial);
    await expect.poll(async()=>await pages[1].locator('#location').textContent()===await host.locator('#location').textContent()).toBe(true);
    const initialAngle=await host.locator('#compass').textContent();
    const initialBody=await host.locator('#body-heading').textContent();
    await pages[1].locator('#viewport').focus();await pages[1].keyboard.down('ArrowRight');await pages[1].waitForTimeout(500);await pages[1].keyboard.up('ArrowRight');
    await expect(host.locator('#compass')).not.toHaveText(initialAngle);
    await expect(host.locator('#body-heading')).toHaveText(initialBody);
    await pages[1].keyboard.down('ArrowUp');await pages[1].waitForTimeout(250);await pages[1].keyboard.up('ArrowUp');
    await expect(host.locator('#compass')).not.toContainText('/ P 0°');
    await expect.poll(async()=>await pages[1].locator('#compass').textContent()===await host.locator('#compass').textContent()).toBe(true);
    const headAfter=await host.locator('#compass').textContent();
    await host.locator('#viewport').focus();await host.keyboard.down('c');await host.waitForTimeout(300);await host.keyboard.up('c');
    await expect(host.locator('#body-heading')).not.toHaveText(initialBody);
    await expect(host.locator('#compass')).toHaveText(headAfter);
    await expect.poll(async()=>await pages[1].locator('#body-heading').textContent()===await host.locator('#body-heading').textContent()).toBe(true);
    await pages[1].keyboard.press('q');await expect(host.locator('#signal')).toContainText('進んで大丈夫');
    await pages[3].getByRole('button',{name:'ロビーへ',exact:true}).click();
    await expect(host.locator('#signal')).toContainText('接続待ち');
    const paused=await host.locator('#timer').textContent();await host.waitForTimeout(1200);await expect(host.locator('#timer')).toHaveText(paused);
    await pages[3].locator('#room-input').fill(code);await pages[3].locator('#join-form button').click();
    await expect(pages[3].locator('#game')).toBeVisible({timeout:25000});
    await expect(host.locator('#game-network')).toContainText('4/4');
    await host.getByRole('button',{name:'ロビーへ',exact:true}).click();
    await expect(pages[1].locator('#lobby')).toBeVisible();
    await expect(pages[1].locator('#connection-status')).toContainText('ホストとの接続が切れました');
    expect(errors).toEqual([]);
  }finally{for(const context of contexts)await context.close();}
});

test('articulated opponent and self monitor render at different head and body directions',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  await page.evaluate(async()=>{
    const {createState}=await import('/src/engine.js'),{Renderer}=await import('/src/renderer.js');
    const canvas=document.createElement('canvas');canvas.id='pose-scene';canvas.width=960;canvas.height=600;
    const preview=document.createElement('canvas');preview.id='pose-self';preview.width=220;preview.height=280;
    document.querySelector('#lobby').hidden=true;document.body.append(canvas,preview);
    const state=createState();Object.assign(state.teams[1],{x:2.5,y:10.5,bodyAngle:Math.PI/2,angle:Math.PI/3,pitch:.3,gait:Math.PI/2,moveSpeed:1});
    new Renderer(canvas,preview).draw(state,'a-lower');
  });
  await page.locator('#pose-scene').screenshot({path:'test-results/humanoid.png'});
  await page.locator('#pose-self').screenshot({path:'test-results/body-monitor.png'});
  expect(errors).toEqual([]);
});

test('four peers complete exactly three timed rounds, synchronize results and can rematch',async({browser})=>{
  const contexts=[],pages=[];
  try{
    for(let i=0;i<4;i++){
      const context=await browser.newContext();contexts.push(context);
      // Shorten the real simulation clock in the test only; no production debug hooks.
      await context.route('**/src/engine.js',async route=>{
        const response=await route.fetch();
        const body=(await response.text()).replace('ROUND_SECONDS=90','ROUND_SECONDS=2').replace('ROUND_BREAK=5','ROUND_BREAK=2');
        await route.fulfill({response,body});
      });
      const page=await context.newPage();pages.push(page);await page.goto('/');
    }
    const host=pages[0];await host.locator('#create-room').click();
    await expect(host.locator('#room-panel')).toBeVisible({timeout:25000});
    const code=await host.locator('#room-code').textContent();
    for(const page of pages.slice(1)){
      await page.locator('#room-input').fill(code);await page.locator('#join-form button').click();
      await expect(page.locator('#room-panel')).toBeVisible({timeout:25000});
    }
    await host.locator('#start-game').click();
    for(let round=1;round<=3;round++){
      await expect(host.locator('#round-label')).toHaveText(`ROUND ${round} / 3`,{timeout:10000});
      await expect(host.locator('#result-kicker')).toHaveText(round===3?'MATCH COMPLETE':`ROUND ${round} / 3 COMPLETE`,{timeout:10000});
    }
    for(const page of pages){
      await expect(page.locator('#result-title')).toHaveText('引き分け');
      await expect(page.locator('#result-description')).toContainText('R1: DRAW / R2: DRAW / R3: DRAW');
      await expect(page.locator('#core-count')).toHaveText('A 0 : 0 B');
    }
    await expect(pages[1].locator('#retry')).toBeHidden();
    await host.screenshot({path:'test-results/duel-result.png'});
    await host.locator('#retry').click();
    for(const page of pages){
      await expect(page.locator('#round-label')).toHaveText('ROUND 1 / 3');
      await expect(page.locator('#result')).toBeHidden();
    }
  }finally{for(const context of contexts)await context.close();}
});
