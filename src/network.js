import {SLOTS,sanitizeInput} from './engine.js?v=20261013-2';
import {peerOptions,iceServersUrl} from '../network-config.js?v=20261013-3';

const PREFIX='split-signal-v5-';
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
  'peer-unavailable':'[ROOM_NOT_FOUND] ルームが見つかりません。ホストがルームを開いたままか確認し、全員でページを再読み込みして新しい招待URLを共有してください。',
  'unavailable-id':'コードが使用中です。もう一度ルームを作成してください。',
  'network':'[SIGNALING_ERROR] 接続サーバーに到達できません。ネットワークを確認してください。',
  'server-error':'[SIGNALING_ERROR] 接続サーバーでエラーが発生しました。少し待ってからやり直してください。',
  'socket-error':'[SIGNALING_ERROR] 接続サーバーとの通信に失敗しました。',
  'webrtc':'[P2P_FAILED] プレイヤー間の通信経路を確立できません。別回線で試すか、公開者がTURN中継を設定する必要があります。',
  'browser-incompatible':'このブラウザはWebRTCに対応していません。Chromeなどで開いてください。',
}[error.type]||`接続エラー：${error.type||'unknown'}`);

async function connectionOptions(){
  const overrides={...peerOptions,...(globalThis.SPLIT_SIGNAL_PEER_OPTIONS||{})};
  // PeerJS 1.5.5 includes discontinued PeerJS TURN servers in its defaults.
  const config={iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}],...overrides.config};
  if(iceServersUrl){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(iceServersUrl,{signal:controller.signal,cache:'no-store',credentials:'omit'});
      if(!response.ok)throw new Error();
      const data=await response.json(),servers=Array.isArray(data)?data:data.iceServers;
      if(!Array.isArray(servers)||!servers.length||!servers.every(server=>{
        const urls=Array.isArray(server?.urls)?server.urls:[server?.urls];
        return urls.length&&urls.every(url=>typeof url==='string'&&/^(stun|stuns|turn|turns):/.test(url));
      }))throw new Error();
      config.iceServers=[...config.iceServers,...servers];
    }catch{
      throw new Error('[TURN_CONFIG] 中継設定を取得できません。公開者がnetwork-config.jsの取得先と設定を確認してください。');
    }finally{clearTimeout(timer);}
  }
  return {debug:0,...overrides,config};
}

export class Room {
  constructor(callbacks={}){
    this.callbacks=callbacks;this.players=[];this.connections=new Map();this.inputs={};this.lastInput={};
    this.isHost=false;this.closed=false;this.slot=null;this.id=null;this.code='';this.lastStateAt=0;
    this.reconnectAttempts=0;
  }
  async open(host,code,name){
    this.isHost=host;this.code=code;this.name=cleanName(name);
    const [Peer,options]=await Promise.all([loadPeer(),connectionOptions()]);
    if(this.closed)throw new Error('接続はキャンセルされました。');
    this.hasRelay=options.config.iceServers.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/.test(url)));
    this.peer=host?new Peer(PREFIX+code,options):new Peer(options);
    return new Promise((resolve,reject)=>{
      let settled=false,initialized=false,joinAttempts=0;
      const fail=error=>{
        if(this.closed)return;
        if(!settled){settled=true;reject(error);this.close();}
        else this.callbacks.onError?.(error.message);
      };
      this.cancelOpen=()=>{if(!settled){settled=true;reject(new Error('接続はキャンセルされました。'));}};
      const deadline=(ms,message)=>{clearTimeout(this.openTimer);this.openTimer=setTimeout(()=>fail(new Error(typeof message==='function'?message():message)),ms);};
      const ready=()=>{if(!settled){settled=true;clearTimeout(this.openTimer);resolve(this);}};
      deadline(20000,'[SIGNALING_TIMEOUT] 接続サーバーの応答がありません。インターネット接続を確認するか、別回線で試してください。');
      this.callbacks.onStatus?.('接続サーバーに接続しています…');
      const join=()=>{
        if(this.closed)return;
        if(!this.peer.open){this.joinTimer=setTimeout(join,1000);return;}
        joinAttempts++;
        this.callbacks.onStatus?.('ホストを探して、プレイヤー間の通信経路を確認しています…');
        const connection=this.peer.connect(PREFIX+code,{reliable:true,serialization:'json',metadata:{game:'split-signal',version:5,name:this.name}});
        this.hostConnection=connection;
        connection.on('open',()=>{
          if(this.closed||settled||this.hostConnection!==connection)return;
          this.callbacks.onStatus?.('通信経路がつながりました。入室情報を確認しています…');
          // Request a fresh roster after the guest's channel is ready.
          this.safeSend(connection,{type:'hello'});
          clearInterval(this.rosterTimer);
          this.rosterTimer=setInterval(()=>{
            if(!this.closed&&!settled&&this.hostConnection===connection)this.safeSend(connection,{type:'hello'});
          },1500);
        });
        connection.on('data',data=>{
          if(!data||typeof data!=='object'||this.closed||this.hostConnection!==connection)return;
          if(data.type==='reject'){fail(new Error(data.message));return;}
          if(data.type==='roster'&&Array.isArray(data.players)){
            this.players=data.players;this.slot=this.players.find(p=>p.id===this.id)?.slot||null;
            if(!this.slot)return;
            clearInterval(this.rosterTimer);this.callbacks.onRoster?.(this.players);ready();
          }
          if(data.type==='state'&&this.slot){this.lastStateAt=performance.now();this.callbacks.onState?.(data.state);}
          if(data.type==='notice')this.callbacks.onError?.(data.message);
        });
        connection.on('iceStateChanged',state=>{
          if(this.closed||this.hostConnection!==connection)return;
          if(state==='checking')this.callbacks.onStatus?.('ホストが応答しました。プレイヤー間の接続を確立しています…');
        });
        connection.on('close',()=>{
          if(this.closed||this.hostConnection!==connection)return;
          if(!settled)fail(new Error(peerError({type:'webrtc'})));
          else this.callbacks.onClosed?.('ホストとの接続が切れました。ロビーから入り直してください。');
        });
        connection.on('error',()=>{
          if(this.hostConnection===connection)fail(new Error(peerError({type:'webrtc'})));
        });
      };
      this.peer.on('error',e=>{
        if(this.closed)return;
        if(e.type==='peer-unavailable'&&!host&&!settled){
          // The host may be re-registering after a short signaling outage.
          const previous=this.hostConnection;this.hostConnection=null;previous?.close();
          if(joinAttempts<4){
            this.callbacks.onStatus?.('ホストの再接続を待っています…');
            clearTimeout(this.joinTimer);this.joinTimer=setTimeout(join,2000);return;
          }
        }
        if(initialized&&['network','socket-error','server-error','disconnected'].includes(e.type)){
          this.scheduleReconnect();return;
        }
        fail(new Error(peerError(e)));
      });
      this.peer.on('disconnected',()=>{
        if(this.closed)return;
        this.callbacks.onError?.('接続サーバーへ再接続しています。ホストのタブを開いたままお待ちください。');
        this.scheduleReconnect();
      });
      this.wake=()=>{
        if(!this.closed&&!this.peer.open){this.reconnectAttempts=0;this.scheduleReconnect();}
      };
      globalThis.addEventListener?.('online',this.wake);
      globalThis.addEventListener?.('focus',this.wake);
      if(host)this.peer.on('connection',c=>this.accept(c));
      this.peer.on('open',id=>{
        if(this.closed)return;
        clearTimeout(this.reconnectTimer);this.reconnectTimer=null;
        const recovering=this.reconnectAttempts>0;this.reconnectAttempts=0;
        if(recovering)this.callbacks.onStatus?.('接続サーバーへの再接続が完了しました。参加を受け付けています。');
        // PeerJS emits open again after reconnect. Never reset a live roster.
        if(initialized)return;
        initialized=true;
        this.id=id;
        if(host){
          this.slot='a-lower';this.players=[{id,name:this.name,slot:this.slot,host:true}];
          this.publishRoster();ready();
        }else{
          deadline(45000,()=>this.joinFailure());
          join();
        }
      });
    });
  }
  joinFailure(){
    const connection=this.hostConnection;
    if(connection?.open)return '[JOIN_TIMEOUT] 通信は成立しましたが入室情報を受信できません。全員がページを再読み込みし、ルームを作り直してください。';
    const ice=connection?.peerConnection?.iceConnectionState||'unknown';
    return `[P2P_TIMEOUT] プレイヤー間の通信経路を確立できませんでした（ICE: ${ice} / TURN: ${this.hasRelay?'設定あり':'未設定'}）。`+
      (this.hasRelay?'中継サーバーの認証・到達性と両者の回線を確認してください。':'直接接続できない回線にはTURN中継の設定が必要です。まず同じWi-Fiで接続できるか確認してください。');
  }
  scheduleReconnect(){
    if(this.closed||this.reconnectTimer)return;
    if(this.peer.destroyed||this.reconnectAttempts>=6){
      this.callbacks.onError?.('[SIGNALING_LOST] 接続サーバーに復帰できません。既存の対戦は続けられますが、新規参加には回線を確認してルームを作り直してください。');return;
    }
    this.reconnectTimer=setTimeout(()=>{
      this.reconnectTimer=null;
      if(this.closed||this.peer.open)return;
      this.reconnectAttempts++;
      if(!this.peer.disconnected)this.peer.disconnect();
      try{this.peer.reconnect();}catch{/* Retry within the same bounded budget. */}
      this.scheduleReconnect();
    },Math.min(1000*2**this.reconnectAttempts,8000));
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
  ping(){if(this.isHost)this.callbacks.onPing?.(this.slot);else this.safeSend(this.hostConnection,{type:'ping'});}
  broadcastState(state){for(const c of this.connections.values())this.safeSend(c,{type:'state',state});}
  readInputs(){
    const now=performance.now(),result={};
    for(const [slot,input]of Object.entries(this.inputs)){
      if(now-(this.lastInput[slot]||0)<400)result[slot]={...input};
      input.look=0; // Mouse movement is a delta, not a held key.
      input.pitchLook=0;
    }
    return result;
  }
  close(){
    this.closed=true;this.cancelOpen?.();
    clearInterval(this.rosterTimer);clearTimeout(this.openTimer);clearTimeout(this.joinTimer);clearTimeout(this.reconnectTimer);
    globalThis.removeEventListener?.('online',this.wake);globalThis.removeEventListener?.('focus',this.wake);
    this.hostConnection?.close();for(const c of this.connections.values())c.close();
    this.peer?.destroy();this.connections.clear();this.players=[];this.inputs={};
  }
}

export function generateCode(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map(b=>alphabet[b%alphabet.length]).join('');
}
