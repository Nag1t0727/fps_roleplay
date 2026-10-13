import {test,expect} from '@playwright/test';

test('recorded demo plays, pauses, and previews a readable translucent background',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/demo/',{waitUntil:'domcontentloaded'});
  const video=page.locator('#movie');
  await page.getByRole('button',{name:'再生する',exact:true}).click();
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(.3);
  await page.getByRole('button',{name:'一時停止',exact:true}).click();
  expect(await video.evaluate(v=>v.paused)).toBe(true);
  const metadata=await video.evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration,muted:v.muted,loop:v.loop}));
  expect(metadata.width).toBe(1280);expect(metadata.height).toBe(720);
  expect(metadata.duration).toBeGreaterThan(11.5);expect(metadata.duration).toBeLessThan(12.5);
  expect(metadata.muted&&metadata.loop).toBe(true);
  await video.evaluate(v=>new Promise(resolve=>{v.onseeked=resolve;v.currentTime=3.35;}));
  await page.screenshot({path:'test-results/demo-preview.png',fullPage:true});
  await page.getByRole('button',{name:'背景向けの薄さで見る'}).click();
  await expect(video).toHaveCSS('opacity','0.22');await expect(page.locator('#overlay')).toBeVisible();
  await page.screenshot({path:'test-results/demo-background.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button',{name:'通常の明るさに戻す'}).click();
  await expect(video).toHaveCSS('opacity','1');
  expect(errors).toEqual([]);
});
