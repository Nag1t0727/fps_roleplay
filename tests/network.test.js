import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setImmediate} from 'node:timers/promises';
import {Room} from '../src/network.js';
import {createState,placePing} from '../src/engine.js';

class Connection extends EventEmitter{
  send(){}
  close(){this.closed=true;this.emit('close');}
}

test('remote pins use the assigned seat and host cooldown, never a supplied team or position',()=>{
  const state=createState(),room=new Room({onPing:slot=>placePing(state,slot)});
  room.players=[{id:'host',slot:'a-upper'}];
  const connection=new Connection();Object.assign(connection,{peer:'guest',open:true,metadata:{game:'split-signal',version:5,name:'Guest'}});
  room.accept(connection);connection.emit('open');
  connection.emit('data',{type:'ping',slot:'a-upper',x:999,y:999});
  assert.equal(state.pings.length,0);
  connection.emit('data',{type:'claim',slot:'b-upper'});
  connection.emit('data',{type:'ping',slot:'a-upper',x:999,y:999});
  assert.equal(state.pings.length,1);assert.equal(state.pings[0].team,'b');assert.ok(state.pings[0].x<20);
  const first={...state.pings[0]};state.teams[1].angle=0;
  connection.emit('data',{type:'ping'});assert.deepEqual(state.pings[0],first);
  room.close();
});
class Peer extends EventEmitter{
  constructor(id,options){super();this.options=options||id;this.calls=[];this.reconnects=0;}
  register(){this.open=true;this.disconnected=false;this.emit('open','test-peer');}
  connect(){const connection=new Connection();this.calls.push(connection);return connection;}
  disconnect(){this.open=false;this.disconnected=true;this.emit('disconnected');}
  reconnect(){this.disconnected=false;this.reconnects++;}
  destroy(){this.destroyed=true;}
}
function setup(t,callbacks={}){
  t.mock.timers.enable({apis:['setTimeout']});
  const previous=globalThis.Peer;globalThis.Peer=Peer;
  const room=new Room(callbacks);
  t.after(()=>{room.close();globalThis.Peer=previous;});
  return room;
}

test('signaling and P2P have independent deadlines and distinct errors',async t=>{
  const room=setup(t),pending=room.open(false,'ABCDEF','guest');
  const rejected=assert.rejects(pending,/P2P_TIMEOUT/);
  await setImmediate();
  t.mock.timers.tick(19000);room.peer.register();
  t.mock.timers.tick(2000);assert.equal(room.closed,false);
  t.mock.timers.tick(43000);await rejected;
  assert.equal(room.peer.destroyed,true);assert.equal(room.peer.calls[0].closed,true);
});

test('unreachable signaling server times out before attempting P2P',async t=>{
  const room=setup(t),pending=room.open(false,'ABCDEF','guest');
  const rejected=assert.rejects(pending,/SIGNALING_TIMEOUT/);
  await setImmediate();t.mock.timers.tick(20000);await rejected;
  assert.equal(room.peer.calls.length,0);assert.equal(room.peer.destroyed,true);
});

test('a temporarily missing host is retried, stale channels are ignored, and a later roster joins',async t=>{
  const room=setup(t),pending=room.open(false,'ABCDEF','guest');
  await setImmediate();room.peer.register();
  const stale=room.peer.calls[0];room.peer.emit('error',{type:'peer-unavailable'});
  assert.equal(stale.closed,true);
  t.mock.timers.tick(2000);
  stale.emit('data',{type:'reject',message:'stale rejection'});
  room.peer.calls[1].emit('data',{type:'roster',players:[{id:'test-peer',slot:'a-upper'}]});
  assert.equal(await pending,room);assert.equal(room.slot,'a-upper');
  t.mock.timers.tick(60000);assert.equal(room.closed,false);
});

test('missing room fails after bounded retries, without leaving pending channels',async t=>{
  const room=setup(t),pending=room.open(false,'ABCDEF','guest');
  const rejected=assert.rejects(pending,/ROOM_NOT_FOUND/);
  await setImmediate();room.peer.register();
  for(let i=0;i<4;i++){
    room.peer.emit('error',{type:'peer-unavailable'});t.mock.timers.tick(2000);
  }
  await rejected;assert.equal(room.peer.calls.length,4);
  assert.ok(room.peer.calls.every(connection=>connection.closed));
  t.mock.timers.tick(60000);assert.equal(room.peer.calls.length,4);
});

test('closing a pending room cancels its promise and prevents reconnection',async t=>{
  const room=setup(t),pending=room.open(false,'ABCDEF','guest');
  const rejected=assert.rejects(pending,/キャンセル/);
  await setImmediate();room.peer.disconnect();room.close();
  t.mock.timers.tick(60000);await rejected;
  assert.equal(room.peer.reconnects,0);
});

test('recovery has a retry limit and stops immediately on successful registration',async t=>{
  const messages=[],room=setup(t,{onError:message=>messages.push(message)});
  const pending=room.open(true,'ABCDEF','host');await setImmediate();room.peer.register();await pending;
  room.peer.disconnect();
  for(let i=0;i<8;i++)t.mock.timers.tick(8000);
  assert.equal(room.peer.reconnects,6);assert.match(messages.at(-1),/SIGNALING_LOST/);
  room.wake();t.mock.timers.tick(1000);room.peer.register();
  t.mock.timers.tick(60000);assert.equal(room.peer.reconnects,7);
  assert.equal(room.players.length,1);
});

test('default ICE config excludes retired TURN and explicit ICE overrides are preserved',async t=>{
  const room=setup(t),pending=room.open(true,'ABCDEF','host');
  await setImmediate();room.peer.register();await pending;
  assert.ok(room.peer.options.config.iceServers.every(s=>s.urls.every(url=>url.startsWith('stun:'))));
  const override={config:{iceServers:[{urls:'turns:relay.example:443',username:'temporary',credential:'test'}],iceTransportPolicy:'relay'}};
  const previous=globalThis.SPLIT_SIGNAL_PEER_OPTIONS;globalThis.SPLIT_SIGNAL_PEER_OPTIONS=override;
  const another=new Room();
  try{
    const open=another.open(true,'GHIJKL','host');await setImmediate();another.peer.register();await open;
    assert.deepEqual(another.peer.options.config,override.config);
  }finally{another.close();globalThis.SPLIT_SIGNAL_PEER_OPTIONS=previous;}
});

test('guest requests roster again when the initial roster is missing',async t=>{
  const room=setup(t),pending=room.open(false,'ABCDEF','guest');
  await setImmediate();room.peer.register();
  const connection=room.hostConnection,sent=[];
  connection.open=true;connection.send=data=>sent.push(data);connection.emit('open');
  assert.deepEqual(sent,[{type:'hello'}]);
  connection.emit('data',{type:'roster',players:[{id:'test-peer',slot:'a-upper'}]});
  assert.equal(await pending,room);
});

test('host can resend roster without allocating a second seat',()=>{
  const room=new Room(),connection=new Connection(),sent=[];
  room.players=[{id:'host',slot:'a-lower',host:true}];
  Object.assign(connection,{peer:'guest',open:true,metadata:{game:'split-signal',version:5,name:'Guest'},send:data=>sent.push(data)});
  room.accept(connection);connection.emit('open');
  connection.emit('data',{type:'hello'});connection.emit('data',{type:'hello'});
  assert.equal(room.players.length,2);assert.equal(sent.length,3);
  assert.deepEqual(sent[0].players,sent[2].players);room.close();
});

test('timeouts distinguish missing relay, configured relay, and completed transport',()=>{
  const room=new Room();room.hostConnection={peerConnection:{iceConnectionState:'failed'}};
  assert.match(room.joinFailure(),/P2P_TIMEOUT.*ICE: failed.*TURN: 未設定/);
  room.hasRelay=true;assert.match(room.joinFailure(),/TURN: 設定あり/);
  room.hostConnection.open=true;assert.match(room.joinFailure(),/JOIN_TIMEOUT/);
});
