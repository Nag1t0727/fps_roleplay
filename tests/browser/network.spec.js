import {test,expect} from '@playwright/test';

test('signaling reconnect keeps the code, seats and existing data channel, and allows a new guest',async({browser})=>{
  const contexts=[];
  try{
    const pages=[];
    for(let i=0;i<3;i++){
      const context=await browser.newContext();contexts.push(context);
      const page=await context.newPage();pages.push(page);await page.goto('/');
    }
    const [host,guest,newGuest]=pages;
    const code=await host.evaluate(async()=>{
      const {Room,generateCode}=await import('/src/network.js');
      window.room=new Room();await room.open(true,generateCode(),'Host');return room.code;
    });
    await guest.evaluate(async code=>{
      const {Room}=await import('/src/network.js');
      window.received=[];window.room=new Room({onState:state=>received.push(state)});
      await room.open(false,code,'Guest');room.claim('b-upper');
    },code);
    await expect.poll(()=>host.evaluate(()=>room.players.map(p=>p.slot))).toEqual(['a-lower','b-upper']);
    const roster=await host.evaluate(()=>room.players);
    await host.evaluate(()=>room.peer.disconnect());
    await expect.poll(()=>host.evaluate(()=>room.peer.open),{timeout:15000}).toBe(true);
    expect(await host.evaluate(()=>room.players)).toEqual(roster);
    await host.evaluate(()=>room.broadcastState({test:'still-connected'}));
    await expect.poll(()=>guest.evaluate(()=>received)).toContainEqual({test:'still-connected'});
    await newGuest.evaluate(async code=>{
      const {Room}=await import('/src/network.js');window.room=new Room();await room.open(false,code,'New guest');
    },code);
    await expect.poll(()=>host.evaluate(()=>room.players.length)).toBe(3);
    expect(await host.evaluate(()=>room.code)).toBe(code);
    expect(await host.evaluate(()=>room.peer.listenerCount('connection'))).toBe(1);
  }finally{for(const context of contexts)await context.close();}
});

test('temporary TURN settings are fetched on each connection and failures remain actionable',async({page})=>{
  await page.route('**/network-config.js*',route=>route.fulfill({contentType:'text/javascript',body:
    "export const peerOptions={}; export const iceServersUrl='/temporary-ice';"}));
  let requests=0;
  await page.route('**/temporary-ice',route=>{
    requests++;
    return route.fulfill({json:{iceServers:[{urls:'turns:relay.example:443',username:`temporary-${requests}`,credential:'test'}]}});
  });
  await page.goto('/');
  const options=await page.evaluate(async()=>{
    // Capture constructor configuration; this test does not claim the test relay exists.
    globalThis.Peer=class{
      constructor(id,options){this.options=options;}
      on(type,listener){if(type==='open')queueMicrotask(()=>listener('test-host'));}
      destroy(){}
    };
    const {Room}=await import('/src/network.js'),options=[];
    for(let i=0;i<2;i++){
      const room=new Room();await room.open(true,'ABCDEF','host');options.push(room.peer.options.config);room.close();
    }
    return options;
  });
  expect(requests).toBe(2);
  expect(options[0].iceServers.at(-1).username).toBe('temporary-1');
  expect(options[1].iceServers.at(-1).username).toBe('temporary-2');
  await page.route('**/temporary-ice',route=>route.fulfill({status:503,body:'unavailable'}));
  await page.locator('#create-room').click();
  await expect(page.locator('#connection-status')).toContainText('TURN_CONFIG');
  await expect(page.locator('#create-room')).toBeEnabled();
  await expect(page.locator('#room-panel')).toBeHidden();
});
