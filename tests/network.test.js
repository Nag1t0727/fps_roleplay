import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setImmediate} from 'node:timers/promises';
import {Room} from '../src/network.js';
import {createState,placePing} from '../src/engine.js';

function setup(t){
  const clients=new Set(),rooms=[],previous=globalThis.mqtt;
  globalThis.mqtt={connect(){
    const c=new EventEmitter();c.connected=true;c.subscribe=(topic,opts,cb)=>{c.topic=topic;queueMicrotask(()=>cb(null,[{qos:0}]));};
    c.publish=(topic,payload)=>{for(const target of clients)if(target.connected&&target.topic===topic)queueMicrotask(()=>target.emit('message',topic,Buffer.from(payload),{retain:false}));};
    c.end=()=>{clients.delete(c);c.connected=false;};clients.add(c);queueMicrotask(()=>c.emit('connect'));return c;
  }};
  t.after(()=>{for(const r of rooms)r.close();globalThis.mqtt=previous;});
  return callbacks=>{const r=new Room(callbacks);rooms.push(r);return r;};
}
const drain=async()=>{await setImmediate();await setImmediate();};

test('four seats over three brokers, duplicate inputs/pins applied once, capacity and role checks',async t=>{
  const make=setup(t),state=createState(),host=make({onPing:slot=>placePing(state,slot)});
  await host.open(true,'ABCDEF','Host');const guests=[];
  for(let i=0;i<3;i++){const guest=make();await guest.open(false,'ABCDEF','Guest');guests.push(guest);}
  await drain();assert.equal(host.players.length,4);assert.equal(host.readyClients.size,3);
  guests[0].sendInput({look:.2,pitchLook:.1});await drain();assert.equal(host.readInputs()['a-upper'].look,.2);
  guests[0].ping();await drain();assert.equal(state.pings.length,1);assert.equal(state.pings[0].team,'a');
  guests[1].ping();await drain();assert.equal(state.pings.length,1);
  guests[0].claim('b-lower');await drain();assert.equal(guests[0].slot,'a-upper');
  await assert.rejects(make().open(false,'ABCDEF','Fifth'),/満員/);
  guests[2].close();await drain();assert.equal(host.players.length,3);
  const replacement=make();await replacement.open(false,'ABCDEF','Replacement');assert.equal(replacement.slot,'b-upper');
});

test('snapshots ignore duplicates, older sequence numbers and unrelated sender',async t=>{
  const make=setup(t),host=make(),received=[],guest=make({onState:s=>received.push(s)});
  await host.open(true,'ABCDEF','Host');await guest.open(false,'ABCDEF','Guest');
  host.broadcastState({time:10});await drain();assert.deepEqual(received,[{time:10}]);
  const message={v:1,from:host.id,to:'*',seq:1,kind:'state',data:{state:{time:99}}};
  guest.receive(Buffer.from(JSON.stringify(message)));assert.equal(received.length,1);
  message.from='stranger';message.seq=999;guest.receive(Buffer.from(JSON.stringify(message)));assert.equal(received.length,1);
});

test('expired guests free their seats and host leave closes guests',async t=>{
  const make=setup(t),closed=[],host=make(),guest=make({onClosed:m=>closed.push(m)});
  await host.open(true,'ABCDEF','Host');await guest.open(false,'ABCDEF','Guest');
  const conn=host.connections.get(guest.id);conn.last=performance.now()-16000;host.tick();assert.equal(host.players.length,1);
  await drain();host.close();await drain();assert.equal(guest.closed,true);assert.match(closed[0],/ホスト/);
});

test('canceling an unavailable room rejects open and stops clients',async t=>{
  const make=setup(t),guest=make(),pending=guest.open(false,'MISSING','Guest');
  const rejected=assert.rejects(pending,/キャンセル/);await drain();guest.close();await rejected;
  assert.ok(guest.clients.every(c=>!c.connected));
});
