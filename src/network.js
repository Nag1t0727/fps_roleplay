import {SLOTS,sanitizeInput} from './engine.js?v=motion-1';
import {mqttBrokers} from '../network-config.js?v=mqtt-1';

let libraryPromise;
async function loadMqtt(){
  if(globalThis.mqtt)return globalThis.mqtt;
  if(!libraryPromise)libraryPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=new URL('../vendor/mqtt.min.js',import.meta.url).href;
    const timer=setTimeout(fail,12000);
    function fail(){clearTimeout(timer);script.remove();libraryPromise=null;reject(new Error('[MQTT_LIBRARY] 通信ライブラリを読み込めません。再読み込みしてください。'));}
    script.onerror=fail;script.onload=()=>{clearTimeout(timer);globalThis.mqtt?resolve(globalThis.mqtt):fail();};document.head.append(script);
  });
  return libraryPromise;
}
const cleanName=name=>typeof name==='string'?name.trim().slice(0,16)||'パイロット':'パイロット';
class Channel{
  constructor(room,id,name){this.room=room;this.peer=id;this.open=true;this.last=performance.now();this.events={};this.metadata={game:'split-signal',version:5,name};}
  on(event,fn){(this.events[event]??=[]).push(fn);}
  emit(event,data){for(const fn of this.events[event]||[])fn(data);}
  send(data){this.room.publish(data.type,data,this.peer);}
  close(){if(!this.open)return;this.open=false;this.emit('close');}
}
export class Room{
  constructor(callbacks={}){
    this.callbacks=callbacks;this.players=[];this.connections=new Map();this.inputs={};this.lastInput={};
    this.clients=[];this.readyClients=new Set();this.seen=new Map();this.seq=0;this.inputSequence=0;this.inputAcks={};this.epoch=0;this.departed=new Set();
    this.isHost=false;this.closed=false;this.slot=null;this.lastStateAt=0;this.joined=false;
  }
  async open(host,code,name){
    this.isHost=host;this.code=code;this.name=cleanName(name);this.id=crypto.randomUUID();
    this.topic=`split-signal/mqtt-v2/${code}/messages`;
    const mqtt=await loadMqtt();if(this.closed)throw new Error('接続はキャンセルされました。');
    const brokers=globalThis.SPLIT_SIGNAL_MQTT_BROKERS||mqttBrokers;
    if(!Array.isArray(brokers)||!brokers.length)throw new Error('[MQTT_CONFIG] 接続先が設定されていません。');
    return new Promise((resolve,reject)=>{
      this.rejectOpen=reject;
      this.finishOpen=()=>{if(this.joined||this.closed)return;this.joined=true;clearTimeout(this.deadline);this.rejectOpen=null;resolve(this);};
      this.deadline=setTimeout(()=>this.fail('[MQTT_TIMEOUT] 中継サーバーに接続できません。学校の回線制限とインターネット接続を確認してください。'),20000);
      this.callbacks.onStatus?.('中継サーバーに接続しています…');
      for(const url of brokers){
        const client=mqtt.connect(url,{clientId:`ss-${crypto.randomUUID()}`,clean:true,reconnectPeriod:2000,connectTimeout:8000,keepalive:20,queueQoSZero:false,resubscribe:false});
        this.clients.push(client);
        client.on('error',()=>{});
        client.on('connect',()=>{
          if(this.closed)return;
          client.subscribe(this.topic,{qos:0},(error,grants)=>{
            if(this.closed||!client.connected||error||!grants?.length||grants.some(g=>g.qos===128))return;
            this.readyClients.add(client);
            this.callbacks.onStatus?.(`中継サーバーに接続しました（${this.readyClients.size}/${brokers.length}）。${host?'参加を受け付けています。':'ルームを探しています…'}`);
            if(!this.started){
              this.started=true;clearTimeout(this.deadline);
              if(host){this.slot='a-lower';this.players=[{id:this.id,name:this.name,slot:this.slot,host:true}];this.finishOpen();}
              else this.deadline=setTimeout(()=>this.fail(`[ROOM_TIMEOUT] 中継には接続できましたが、ホストから入室情報が届きません（接続先 ${this.readyClients.size}/${brokers.length}）。同じ最新版のページとコードか確認し、ホストのタブを開いたままにしてください。`),30000);
              this.heartbeat=setInterval(()=>this.tick(),1000);
            }
            this.announce();
          });
        });
        client.on('close',()=>{this.readyClients.delete(client);if(!this.closed&&!this.readyClients.size)this.callbacks.onError?.('中継サーバーへ再接続しています…');});
        client.on('message',(topic,bytes,packet)=>{if(topic===this.topic&&!packet?.retain)this.receive(bytes);});
      }
    });
  }
  fail(message){
    const reject=this.rejectOpen;this.rejectOpen=null;
    if(reject){reject(new Error(message));this.close();}
    else{this.close();this.callbacks.onClosed?.(message);}
  }
  publish(kind,data,to='*'){
    if(this.closed)return;
    const payload=JSON.stringify({v:1,from:this.id,to,seq:++this.seq,kind,data});
    for(const client of this.readyClients){
      if(!client.connected)continue;
      // Do not accumulate old movement/snapshots when a socket stalls.
      if((client.stream?.socket?.bufferedAmount||0)>128000)continue;
      client.publish(this.topic,payload,{qos:0,retain:false});
    }
  }
  announce(){
    if(this.isHost)this.publishRoster();
    else this.publish('join',{name:this.name},this.hostId||'*');
  }
  tick(){
    if(this.closed)return;
    const now=performance.now();
    if(this.isHost){for(const c of this.connections.values())if(now-c.last>15000)c.close();}
    else if(this.joined&&now-this.lastHostAt>20000){this.fail('ホストとの通信が20秒間途絶えました。ロビーから入り直してください。');return;}
    this.announce();
  }
  receive(bytes){
    if(this.closed||bytes.length>250000)return;
    let m;try{m=JSON.parse(bytes.toString());}catch{return;}
    if(!m||m.v!==1||typeof m.from!=='string'||m.from===this.id||!Number.isSafeInteger(m.seq)||m.seq<1||typeof m.kind!=='string'||!m.data||typeof m.data!=='object'||(m.to!=='*'&&m.to!==this.id))return;
    const key=`${m.from}:${m.kind}`;
    if(m.seq<=(this.seen.get(key)||0))return;
    this.seen.set(key,m.seq);if(this.seen.size>2048)this.seen.delete(this.seen.keys().next().value);
    if(this.isHost){
      if(m.kind==='roster'&&m.data.players?.some(p=>p.host&&p.id===m.from)){this.fail('[ROOM_IN_USE] 同じコードのルームが存在します。ルームを作り直してください。');return;}
      let c=this.connections.get(m.from);
      if(m.kind==='join'){
        if(this.departed.has(m.from))return;
        if(!c){c=new Channel(this,m.from,m.data.name);this.accept(c);c.emit('open');}
        else this.safeSend(c,{type:'roster',players:this.players});
        c.last=performance.now();return;
      }
      if(!c)return;c.last=performance.now();
      if(m.kind==='leave'){this.departed.add(m.from);c.close();return;}
      c.emit('data',{...m.data,type:m.kind});return;
    }
    if(this.hostId&&m.from!==this.hostId)return;
    if(m.kind==='roster'){
      const players=m.data.players;
      if(!Array.isArray(players)||players.length>4||!players.every(p=>p&&typeof p.id==='string'&&typeof p.name==='string'&&SLOTS.includes(p.slot))||new Set(players.map(p=>p.slot)).size!==players.length||new Set(players.map(p=>p.id)).size!==players.length||players.filter(p=>p.host).length!==1||!players.some(p=>p.host&&p.id===m.from))return;
      this.hostId=m.from;this.lastHostAt=performance.now();
      const me=players.find(p=>p.id===this.id);if(!me){this.announce();return;}
      this.hostConnection??=new Channel(this,this.hostId,'Host');
      this.players=players;this.slot=me.slot;this.callbacks.onRoster?.(players);this.finishOpen();return;
    }
    if(m.kind==='reject'&&!this.joined){this.fail(m.data.message||'入室できません。');return;}
    if(!this.hostId||m.from!==this.hostId)return;
    this.lastHostAt=performance.now();
    if(m.kind==='leave'){this.fail('ホストがルームを閉じました。');return;}
    if(m.kind==='state'&&this.slot){
      const now=performance.now();
      if(this.lastStateAt)this.receiveInterval=(this.receiveInterval||50)*.8+(now-this.lastStateAt)*.2;
      this.lastStateAt=now;this.callbacks.onState?.(m.data.state,{at:m.data.at,epoch:m.data.epoch,acks:m.data.acks||{}});
    }
  }
  accept(connection){
    connection.on('open',()=>{
      if(this.closed){connection.close();return;}
      const metadata=connection.metadata;
      if(metadata?.game!=='split-signal'||metadata.version!==5||this.players.length>=4||this.connections.has(connection.peer)){
        this.safeSend(connection,{type:'reject',message:'ルームが満員、または互換性のない接続です。'});
        setTimeout(()=>connection.close(),250);return;
      }
      const slot=SLOTS.find(s=>!this.players.some(p=>p.slot===s));
      this.connections.set(connection.peer,connection);
      this.players.push({id:connection.peer,name:cleanName(metadata.name),slot,host:false});
      this.publishRoster();
    });
    connection.on('data',data=>{
      const player=this.players.find(p=>p.id===connection.peer);
      if(!player||!data||typeof data!=='object')return;
      if(data.type==='hello'){this.safeSend(connection,{type:'roster',players:this.players.map(({id,name,slot,host})=>({id,name,slot,host}))});return;}
      if(data.type==='input'){
        if(!Number.isSafeInteger(data.inputSeq)||data.inputSeq<=0||data.inputSeq<=(this.inputAcks[player.slot]?.seq||0))return;
        this.inputAcks[player.slot]={seq:data.inputSeq,elapsed:0};
        const clean=sanitizeInput(data.input);
        // Accumulate mouse deltas between host ticks; keyboard state is replaced.
        clean.look=Math.max(-.7,Math.min(.7,(this.inputs[player.slot]?.look||0)+clean.look));
        clean.pitchLook=Math.max(-.7,Math.min(.7,(this.inputs[player.slot]?.pitchLook||0)+clean.pitchLook));
        this.inputs[player.slot]=clean;this.lastInput[player.slot]=performance.now();
      }
      if(data.type==='claim')this.claimFor(player.id,data.slot);
      if(data.type==='ping'&&player.slot.endsWith('upper'))this.callbacks.onPing?.(player.slot);
      if(data.type==='signal'&&[0,1].includes(data.index)){
        const now=performance.now();if(now-(player.lastSignal||0)>600){player.lastSignal=now;this.callbacks.onSignal?.(player.slot,data.index);}
      }
    });
    const remove=()=>{
      if(this.closed||this.connections.get(connection.peer)!==connection)return;
      const p=this.players.find(p=>p.id===connection.peer);if(p){delete this.inputs[p.slot];delete this.lastInput[p.slot];delete this.inputAcks[p.slot];}
      this.players=this.players.filter(p=>p.id!==connection.peer);this.connections.delete(connection.peer);this.publishRoster();
    };
    connection.on('close',remove);connection.on('error',remove);
  }
  safeSend(connection,data){
    if(!connection?.open)return;
    if(data.type==='state'&&(connection.dataChannel?.bufferedAmount||0)>128000)return;
    try{connection.send(data);}catch{this.callbacks.onError?.('通信が不安定です。接続状況を確認してください。');}
  }
  publishRoster(){
    const players=this.players.map(({id,name,slot,host})=>({id,name,slot,host}));
    this.slot=players.find(p=>p.id===this.id)?.slot||this.slot;
    this.publish('roster',{type:'roster',players});
    this.callbacks.onRoster?.(players);
  }
  claimFor(id,slot){
    if(!SLOTS.includes(slot)||this.players.some(p=>p.slot===slot))return;
    const player=this.players.find(p=>p.id===id);if(!player)return;
    delete this.inputs[player.slot];delete this.lastInput[player.slot];delete this.inputAcks[player.slot];player.slot=slot;this.publishRoster();
  }
  claim(slot){if(this.isHost)this.claimFor(this.id,slot);else this.safeSend(this.hostConnection,{type:'claim',slot});}
  sendInput(input){const inputSeq=++this.inputSequence;this.safeSend(this.hostConnection,{type:'input',input,inputSeq});return inputSeq;}
  signal(index){if(this.isHost)this.callbacks.onSignal?.(this.slot,index);else this.safeSend(this.hostConnection,{type:'signal',index});}
  ping(){if(this.isHost)this.callbacks.onPing?.(this.slot);else this.safeSend(this.hostConnection,{type:'ping'});}
  broadcastState(state){
    if(this.broadcastSource!==state){this.broadcastSource=state;this.epoch++;}
    this.publish('state',{type:'state',state,at:performance.now(),epoch:this.epoch,acks:this.inputAcks});
  }
  readInputs(dt=0){
    const now=performance.now(),result={};
    for(const [slot,input]of Object.entries(this.inputs)){
      if(now-(this.lastInput[slot]||0)<400){
        result[slot]={...input};
        if(this.inputAcks[slot])this.inputAcks[slot].elapsed+=Math.max(0,Math.min(dt,.05));
      }
      input.look=0; // Mouse movement is a delta, not a held key.
      input.pitchLook=0;
    }
    return result;
  }
  close(){
    if(this.closed)return;
    this.publish('leave',{},this.isHost?'*':this.hostId||'*');
    this.closed=true;this.rejectOpen?.(new Error('接続はキャンセルされました。'));this.rejectOpen=null;
    clearTimeout(this.deadline);clearInterval(this.heartbeat);
    for(const client of this.clients){
      if(!client.connected){client.end(true);continue;}
      // Flush the leave packet before closing the WebSocket.
      const timer=setTimeout(()=>client.end(true),1500);timer.unref?.();
      client.end(false,()=>clearTimeout(timer));
    }
    this.readyClients.clear();this.connections.clear();this.players=[];this.inputs={};
  }
}
export function generateCode(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map(b=>alphabet[b%alphabet.length]).join('');
}
