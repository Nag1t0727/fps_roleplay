import {test,expect} from './mqtt-fixture.js';

test('MQTT reconnect keeps seats and existing guests and allows a new guest',async({browser})=>{
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
      const {Room}=await import('/src/network.js');window.received=[];
      window.room=new Room({onState:state=>received.push(state)});await room.open(false,code,'Guest');room.claim('b-upper');
    },code);
    await expect.poll(()=>host.evaluate(()=>room.players.map(p=>p.slot))).toEqual(['a-lower','b-upper']);
    const roster=await host.evaluate(()=>room.players);
    await host.evaluate(()=>{for(const client of room.clients)client.stream.destroy();});
    await expect.poll(()=>host.evaluate(()=>room.readyClients.size),{timeout:12000}).toBeGreaterThan(0);
    expect(await host.evaluate(()=>room.players)).toEqual(roster);
    await host.evaluate(()=>room.broadcastState({test:'still-connected'}));
    await expect.poll(()=>guest.evaluate(()=>received)).toContainEqual({test:'still-connected'});
    await newGuest.evaluate(async code=>{
      const {Room}=await import('/src/network.js');window.room=new Room();await room.open(false,code,'New guest');
    },code);
    await expect.poll(()=>host.evaluate(()=>room.players.length)).toBe(3);
    for(const page of pages)await page.evaluate(()=>room.close());
  }finally{for(const context of contexts)await context.close();}
});
