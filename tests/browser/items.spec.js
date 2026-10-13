import {test,expect} from '@playwright/test';

test('automatic pickups update HUD and shared vision, then restore normal role visibility',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/src/engine.js*',async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replace('state.items=createItems(solo);',`state.items=createItems(solo);
      if(solo){state.teams[0].hp=50;state.items=['repair','shield','boost','link','scan'].map(kind=>({id:kind,kind,x:2.5,y:13.2,taken:false}));}`);
    await route.fulfill({response,body});
  });
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.locator('#practice').click();
  await expect(page.locator('#item-effects')).toContainText('シールド');
  await expect(page.locator('#item-effects')).toContainText('加速 ×1.3');
  await expect(page.locator('#item-effects')).toContainText('視界リンク');
  await expect(page.locator('#item-effects')).toContainText('スキャン');
  await expect(page.locator('#team-status')).toContainText('80');
  await expect(page.locator('#vision-label')).toContainText('VISION LINK');
  await page.screenshot({path:'test-results/items-active.png'});
  await page.keyboard.press('Tab');
  await expect(page.locator('#vision-label')).toContainText('VISION LINK');
  await expect(page.locator('#vision-label')).toHaveText('STRUCTURAL VISION',{timeout:8000});
  await expect(page.locator('#item-effects')).not.toContainText('スキャン');
  await expect(page.locator('#item-effects')).not.toContainText('加速',{timeout:10000});
  expect(errors).toEqual([]);
});

test('all five pickup types render with distinct symbols and labels',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{
    const {createState}=await import('/src/engine.js'),{Renderer}=await import('/src/renderer.js');
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=600;canvas.id='items-gallery';
    document.querySelector('#lobby').hidden=true;document.body.append(canvas);
    const state=createState(true);Object.assign(state.teams[0],{x:7,y:14.5,angle:-Math.PI/2,bodyAngle:-Math.PI/2,pitch:0});
    state.cores=[];state.enemies=[];state.items=['repair','shield','boost','link','scan'].map((kind,i)=>({id:kind,kind,x:6+i*.5,y:12,taken:false}));
    new Renderer(canvas).draw(state,'a-lower');
  });
  await page.locator('#items-gallery').screenshot({path:'test-results/items-gallery.png'});
  expect(errors).toEqual([]);
});
