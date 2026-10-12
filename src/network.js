import {SLOTS,sanitizeInput} from './engine.js';

const PREFIX='split-signal-v1-';
let libraryPromise;
function loadPeer(){
  if(globalThis.Peer)return Promise.resolve(globalThis.Peer);
  if(libraryPromise)return libraryPromise;
  libraryPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='./vendor/peerjs.min.js';
    const timer=setTimeout(()=>fail(),12000);
    function fail(){clearTimeout(timer);script.remove();libraryPromise=null;reject(new Error('通信ライブラリを読み込めません。ページを再読み込みしてください。'));}
    script.onload=()=>{clearTimeout(timer);globalThis.Peer?resolve(globalThis.Peer):fail();};script.onerror=fail;
    document.head.append(script);
  });
  return libraryPromise;
}
const cleanName=name=>typeof name==='string'?name.trim().slice(0,16)||'パイロット':'パイロット';
const peerError=error=>({
  'peer-unavailable':'ルームが見つかりません。コードとホストの接続を確認してください。',
  'unavailable-id':'コードが使用中です。もう一度ルームを作成してください。',
  'network':'接続サーバーに到達できません。ネットワークを確認してください。',
  'webrtc':'P2P接続に失敗しました。別のネットワークで試してください。',
  'browser-incompatible':'このブラウザはWebRTCに対応していません。Chromeなどで開いてください。',
}[error.type]||`接続エラー：${error.type||'unknown'}`);

export class Room {
  constructor(callbacks={}){
    this.callbacks=callbacks;this.players=[];this.connections=new Map();this.inputs={};this.lastInput={};
    this.isHost=false;this.closed=false;this.slot=null;this.id=null;this.code='';this.lastStateAt=0;
  }
  async open(host,code,name){
    this.isHost=host;this.code=code;this.name=cleanName(name);
    const Peer=await loadPeer();
    if(this.closed)throw new Error('接続はキャンセルされました。');
    // Optional ICE overrides (e.g. your own short-lived TURN credentials).
    const options={debug:0,...(globalThis.SPLIT_SIGNAL_PEER_OPTIONS||{})};
    this.peer=host?new Peer(PREFIX+code,options):new Peer(options);
    return new Promise((resolve,reject)=>{
      let settled=false;
      const timer=setTimeout(()=>fail(new Error('接続がタイムアウトしました。学校の回線で制限されている場合は別の回線を試してください。')),18000);
      const fail=error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);this.close();}else this.callbacks.onError?.(error.message);};
      const ready=()=>{if(!settled){settled=true;clearTimeout(timer);resolve(this);}};
      this.peer.on('error',e=>fail(new Error(peerError(e))));
      this.peer.on('disconnected',()=>this.callbacks.onError?.('接続サーバーとの接続が切れました。既存のP2P通信は継続しますが、新規参加にはルームの作り直しが必要です。'));
      this.peer.on('open',id=>{
        if(this.closed)return;
        this.id=id;
        if(host){
          this.slot='a-lower';this.players=[{id,name:this.name,slot:this.slot,host:true}];
          this.peer.on('connection',c=>this.accept(c));this.publishRoster();ready();
        }else{
          this.hostConnection=this.peer.connect(PREFIX+code,{reliable:true,serialization:'json',metadata:{game:'split-signal',version:1,name:this.name}});
          this.hostConnection.on('data',data=>{
            if(!data||typeof data!=='object'||this.closed)return;
            if(data.type==='reject'){fail(new Error(data.message));return;}
            if(data.type==='roster'&&Array.isArray(data.players)){
              this.players=data.players;this.slot=this.players.find(p=>p.id===this.id)?.slot||null;
              if(!this.slot)return;
              this.callbacks.onRoster?.(this.players);ready();
            }
            if(data.type==='state'&&this.slot){this.lastStateAt=performance.now();this.callbacks.onState?.(data.state);}
            if(data.type==='notice')this.callbacks.onError?.(data.message);
          });
          this.hostConnection.on('close',()=>{
            if(this.closed)return;
            if(!settled)fail(new Error('ホストとの接続が切れました。'));
            else this.callbacks.onClosed?.('ホストとの接続が切れました。ロビーから入り直してください。');
          });
          this.hostConnection.on('error',()=>fail(new Error('ホストとの通信に失敗しました。')));
        }
      });
    });
  }
  accept(connection){
    connection.on('open',()=>{
      if(this.closed){connection.close();return;}
      const metadata=connection.metadata;
      if(metadata?.game!=='split-signal'||metadata.version!==1||this.players.length>=4||this.connections.has(connection.peer)){
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
      if(data.type==='input'){
        const clean=sanitizeInput(data.input);
        // Accumulate mouse deltas between host ticks; keyboard state is replaced.
        clean.look=Math.max(-.7,Math.min(.7,(this.inputs[player.slot]?.look||0)+clean.look));
        this.inputs[player.slot]=clean;this.lastInput[player.slot]=performance.now();
      }
      if(data.type==='claim')this.claimFor(player.id,data.slot);
      if(data.type==='signal'&&[0,1].includes(data.index)){
        const now=performance.now();if(now-(player.lastSignal||0)>600){player.lastSignal=now;this.callbacks.onSignal?.(player.slot,data.index);}
      }
    });
    const remove=()=>{
      if(this.closed||this.connections.get(connection.peer)!==connection)return;
      const p=this.players.find(p=>p.id===connection.peer);if(p){delete this.inputs[p.slot];delete this.lastInput[p.slot];}
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
    for(const c of this.connections.values())this.safeSend(c,{type:'roster',players});
    this.callbacks.onRoster?.(players);
  }
  claimFor(id,slot){
    if(!SLOTS.includes(slot)||this.players.some(p=>p.slot===slot))return;
    const player=this.players.find(p=>p.id===id);if(!player)return;
    delete this.inputs[player.slot];delete this.lastInput[player.slot];player.slot=slot;this.publishRoster();
  }
  claim(slot){if(this.isHost)this.claimFor(this.id,slot);else this.safeSend(this.hostConnection,{type:'claim',slot});}
  sendInput(input){this.safeSend(this.hostConnection,{type:'input',input});}
  signal(index){if(this.isHost)this.callbacks.onSignal?.(this.slot,index);else this.safeSend(this.hostConnection,{type:'signal',index});}
  broadcastState(state){for(const c of this.connections.values())this.safeSend(c,{type:'state',state});}
  readInputs(){
    const now=performance.now(),result={};
    for(const [slot,input]of Object.entries(this.inputs)){
      if(now-(this.lastInput[slot]||0)<400)result[slot]={...input};
      input.look=0; // Mouse movement is a delta, not a held key.
    }
    return result;
  }
  close(){
    this.closed=true;this.hostConnection?.close();for(const c of this.connections.values())c.close();
    this.peer?.destroy();this.connections.clear();this.players=[];this.inputs={};
  }
}

export function generateCode(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map(b=>alphabet[b%alphabet.length]).join('');
}
