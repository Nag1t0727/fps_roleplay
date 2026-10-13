import {createState,step,blankInput,addSignal,placePing,SLOTS,SLOT_LABELS,ROUND_COUNT,ITEM_INFO} from './engine.js?v=20261013-2';
import {Renderer} from './renderer.js?v=20261013-2';
import {Room,generateCode} from './network.js?v=mqtt-1';

const $=id=>document.getElementById(id),renderer=new Renderer($('viewport'),$('body-preview'));
let room=null,state=null,slot='a-lower',solo=false,inGame=false,connecting=false;
let keys=new Set(),mouseDown=false,lookDelta=0,pitchDelta=0,lastFrame=performance.now(),netElapsed=0,hudElapsed=0,resultShown=false;
let networkIssue='',lastSignal=0;
const hashCode=new URLSearchParams(location.hash.slice(1)).get('room');
if(hashCode&&/^[a-z0-9]{6}$/i.test(hashCode))$('room-input').value=hashCode.toUpperCase();
try{$('player-name').value=localStorage.getItem('split-signal-name')||'';}catch{}

function status(text,error=false){$('connection-status').textContent=text;$('connection-status').classList.toggle('error',error);}
function setConnecting(value){connecting=value;$('create-room').disabled=value||!!room;$('join-form').querySelector('button').disabled=value||!!room;$('practice').disabled=value;}
function clearControls(){keys.clear();mouseDown=false;lookDelta=0;pitchDelta=0;if(room&&!room.isHost)room.sendInput(blankInput());}

async function connect(host){
  if(connecting||room)return;
  const code=host?generateCode():$('room-input').value.trim().toUpperCase();
  if(!/^[A-Z0-9]{6}$/.test(code)){status('6桁のルームコードを入力してください。',true);return;}
  const name=$('player-name').value.trim()||'パイロット';
  try{localStorage.setItem('split-signal-name',name);}catch{}
  setConnecting(true);status(host?'ルームを作成しています…':'中継サーバー経由でホストに接続しています…');
  const session=new Room({
    onRoster:()=>{if(room!==session)return;slot=session.slot||slot;renderRoom();if(inGame)configureRole();},
    onState:next=>{if(room!==session)return;state=next;if(!inGame)enterGame(false);},
    onSignal:(from,index)=>{if(state&&state.status==='playing')addSignal(state,from,index);},
    onPing:from=>{if(state&&session.players.length===4)placePing(state,from);},
    onError:message=>{if(room!==session)return;networkIssue=message;status(message,true);},
    onStatus:message=>{if(room!==session)return;networkIssue='';status(message);},
    onClosed:message=>{if(room!==session)return;exitGame();leaveRoom();status(message,true);},
  });
  room=session;
  try{
    await session.open(host,code,name);if(room!==session)return;
    slot=room.slot;networkIssue='';$('room-code').textContent=code;
    $('room-panel').hidden=false;$('practice-block').hidden=true;
    status(host?'ルームを作成しました。招待を3人に共有してください。':'接続しました。役割を選んでホストの開始を待ちましょう。');
    renderRoom();
  }catch(error){if(room===session){session.close();room=null;status(error.message,true);}}
  finally{setConnecting(false);}
}

function renderRoom(){
  if(!room)return;
  $('seats').replaceChildren();
  for(const s of SLOTS){
    const p=room.players.find(p=>p.slot===s),button=document.createElement('button');
    button.className=`seat${p?.id===room.id?' self':''}`;
    button.disabled=!!p;
    const label=document.createElement('small');label.textContent=SLOT_LABELS[s]+(p?.host?' · HOST':'');
    const name=document.createElement('strong');name.textContent=p?`${p.name}${p.id===room.id?'（あなた）':''}`:'空席 → 選択';
    button.append(label,name);button.addEventListener('click',()=>room?.claim(s));$('seats').append(button);
  }
  const full=room.players.length===4;$('start-game').disabled=!room.isHost||!full;
  $('start-game').textContent=room.isHost?(full?'3ラウンドの対戦を開始 →':`接続待ち ${room.players.length} / 4`):'ホストの開始を待っています';
}
function leaveRoom(){
  room?.close();room=null;networkIssue='';$('room-panel').hidden=true;$('practice-block').hidden=false;
  setConnecting(false);status('ルームから退出しました。');
}
function enterGame(practice){
  solo=practice;inGame=true;resultShown=false;clearControls();
  if(practice){slot='a-lower';state=createState(true);}else slot=room.slot;
  $('lobby').hidden=true;$('game').hidden=false;$('result').hidden=true;document.body.classList.add('playing');
  $('switch-role').hidden=!practice;configureRole();window.scrollTo(0,0);$('viewport').focus({preventScroll:true});
  lastFrame=performance.now();netElapsed=0;hudElapsed=.2;
}
function exitGame(){
  clearControls();document.exitPointerLock?.();inGame=false;state=null;solo=false;
  $('game').hidden=true;$('lobby').hidden=false;document.body.classList.remove('playing');
}
function startMission(){
  if(!room?.isHost||room.players.length!==4)return;
  room.inputs={};room.lastInput={};
  state=createState(false);enterGame(false);room.broadcastState(state);
}
function configureRole(){
  const upper=slot.endsWith('upper'),unit=slot[0].toUpperCase();
  $('mode-label').textContent=solo?'SOLO PRACTICE / TAB TO SWITCH':`2 vs 2 / ROOM ${room?.code||''} / UNIT ${unit}`;
  $('role-title').textContent=upper?'ARCHITECT / 上半身':'SEEKER / 下半身';
  $('vision-label').textContent=upper?'STRUCTURAL VISION':'BIOLOGICAL VISION';
  $('view-note').textContent=upper?(solo?'地形・危険な床・出口：可視 / 敵・コア：不可視':'地形・危険な床：可視 / 相手機体・回復コア：不可視'):(solo?'敵・コア：可視 / 地形の詳細：不可視':'相手機体・回復コア：可視 / 地形の詳細：不可視');
  $('control-title').textContent=upper?'照準・射撃を担当':'移動を担当';
  $('control-description').textContent=upper?'マウスか矢印キーで上下左右に照準。クリックかSpaceで射撃。Gで照準先にピン（15秒に1回）。視線の方向が相棒の前進方向です。':`Wで視線の方向へ前進、Sで後退、A / Dで左右へ移動。方向転換は上半身役の視点操作に追従。${solo?'コアは触れると回収。':'コアで30HP回復。'}`;
  $('control-keys').replaceChildren();
  for(const key of upper?['←','→','↑','↓','SPACE','G']:['W','A','S','D']){const k=document.createElement('kbd');k.textContent=key;$('control-keys').append(k);}
  $('ping-button').hidden=!upper;
  $('signal-one').querySelector('span').textContent=upper?'進んで大丈夫':'正面に敵';
  $('signal-two').querySelector('span').textContent=upper?'止まって！':'コアが見える';
  $('field-note').textContent=solo?'Tabで役割切替。上半身で向きを決め、下半身のWでその方向へ進もう。':upper?'Gのピンで注意してほしい場所を共有。敵は見えないので相棒の報告を聞いて照準を合わせよう。':'相棒のピンは6秒間表示。危険な床は相棒にしか見えません。声を掛け合って進もう。';
  updatePointerHint();
}
function updatePointerHint(){
  const upper=slot.endsWith('upper');
  $('canvas-hint').textContent=upper?(document.pointerLockElement?'マウス：照準 / クリック：射撃 / G：ピン / Esc：解放':'クリックでマウス操作 / 矢印キー：照準 / Space：射撃 / G：ピン'):(solo?'WASD：視線基準の移動 / Tab：役割切替':'WASD：視線基準の移動 / 相棒のピンを確認');
}
function readInput(){
  const input=blankInput();
  if(document.hidden||$('help-dialog').open||state?.status!=='playing')return input;
  if(slot.endsWith('upper')){
    input.turn=(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0);
    input.pitchTurn=(keys.has('ArrowUp')?1:0)-(keys.has('ArrowDown')?1:0);
    input.fire=keys.has('Space')||mouseDown;input.look=lookDelta;lookDelta=0;
    input.pitchLook=pitchDelta;pitchDelta=0;
  }else{
    input.forward=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0);
    input.strafe=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
  }
  return input;
}
function sendSignal(index){
  if(!inGame||!state||state.status!=='playing'||performance.now()-lastSignal<650)return;
  lastSignal=performance.now();if(solo)addSignal(state,slot,index);else room?.signal(index);
}
function sendPing(){
  if(!inGame||!state||state.status!=='playing'||!slot.endsWith('upper')||$('help-dialog').open)return;
  if(solo)placePing(state,slot);else room?.ping();
}
function switchRole(){
  if(!solo||!inGame)return;clearControls();slot=slot.endsWith('lower')?'a-upper':'a-lower';
  document.exitPointerLock?.();configureRole();$('viewport').focus({preventScroll:true});
}

function updateHUD(){
  const team=state.teams.find(t=>t.id===slot[0]);
  const upper=slot.endsWith('upper'),linked=team.link>0;
  $('vision-label').textContent=linked?'VISION LINK / 両方の視界':upper?'STRUCTURAL VISION':'BIOLOGICAL VISION';
  $('view-note').textContent=linked?'視界リンク：敵・アイテム・地形が可視':upper?'地形・危険な床：可視 / 敵・アイテム：不可視':'敵・アイテム：可視 / 地形の詳細：不可視';
  const effects=[['shield','シールド（1発）'],['boost','加速 ×1.3'],['link','視界リンク']].filter(([key])=>team[key]>0).map(([key,label])=>`${label} ${Math.ceil(team[key])}秒`);
  if(team.scans.length)effects.push(`スキャン（取得時の敵位置） ${Math.ceil(team.scans[0].life)}秒`);
  $('item-effects').textContent=effects.join(' / ')||'発動中のアイテムなし';
  $('item-pickup').textContent=team.pickup?(team.pickup.kind==='blocked'?'シールドが攻撃を防いだ！':`${ITEM_INFO[team.pickup.kind].name} 発動！`):'';
  const seconds=Math.ceil(state.time);$('timer').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  const duel=state.mode==='duel';
  $('round-label').textContent=duel?`ROUND ${state.round} / ${ROUND_COUNT}`:'PRACTICE / ESCAPE';
  $('core-count').textContent=duel?`A ${state.scores.a} : ${state.scores.b} B`:`${state.collected} / 4`;
  $('objective').textContent=duel?'相手機体を撃破 / 時間切れは残りHP':state.collected===4?'北東の出口に全機集合':'エネルギーコアを回収';
  const deg=(Math.round(team.angle*180/Math.PI)+450)%360;
  $('compass').textContent=`${['N','NE','E','SE','S','SW','W','NW'][Math.round(deg/45)%8]} · ${String(deg).padStart(3,'0')}° / P ${Math.round(team.pitch*180/Math.PI)}°`;
  const bodyDeg=(Math.round(team.bodyAngle*180/Math.PI)+450)%360;
  const pingWait=Math.ceil(team.pingCooldown||0);
  $('ping-button').disabled=pingWait>0||state.status!=='playing'||(!solo&&room?.players.length!==4);
  $('ping-button').querySelector('span').textContent=pingWait?`ピン：あと${pingWait}秒`:'照準先にピン（15秒に1回）';
  const ping=state.pings?.find(p=>p.team===slot[0]);
  $('ping-status').textContent=ping?`◇ ${slot.endsWith('upper')?'共有中':'相棒のピン'} · あと${Math.ceil(ping.life)}秒`:'ピンは相棒と自分にだけ表示';
  $('body-heading').textContent=`BODY / W ${String(bodyDeg).padStart(3,'0')}°`;
  $('location').textContent=`POSITION ${team.x.toFixed(1)} / ${team.y.toFixed(1)}`;
  const signal=state.signals.find(s=>s.team===slot[0]);
  const paused=!solo&&room?.players.length<4;
  const stale=!solo&&!room?.isHost&&performance.now()-room.lastStateAt>2500;
  $('signal').hidden=!signal&&!paused&&!stale;
  $('signal').textContent=paused?'接続待ち：4人そろうと再開します':stale?'ホストからの更新を待っています…':signal?`${signal.from} → ${signal.text}`:'';
  $('team-status').replaceChildren();
  for(const t of state.teams){
    if(solo&&t.id==='b')continue;
    const card=document.createElement('div');card.className=`team-card${t.id!==slot[0]?' other':''}`;
    const header=document.createElement('header'),label=document.createElement('b'),hp=document.createElement('span');
    label.textContent=`UNIT ${t.id.toUpperCase()}${t.id===slot[0]?' / YOU':' / ENEMY'}`;hp.textContent=`${Math.ceil(t.hp)} HP`;header.append(label,hp);
    const track=document.createElement('div');track.className='health-track';const fill=document.createElement('div');fill.style.width=`${t.hp}%`;track.append(fill);
    const crew=document.createElement('p');crew.textContent=solo?'ひとり練習 / Tabで役割切替':room?.players.filter(p=>p.slot[0]===t.id).map(p=>p.name).join(' + ')||'接続待ち';
    card.append(header,track,crew);$('team-status').append(card);
  }
  $('game-network').textContent=solo?'● LOCAL SIMULATION':networkIssue?'△ 通信状況を確認してください':`● MQTT ${room?.players.length||0}/4 · ${room?.isHost?'HOST':'CONNECTED'}`;
  $('game-network').title=networkIssue;
  if(state.status!=='playing')showResult();
  else if(resultShown){resultShown=false;$('result').hidden=true;clearControls();$('viewport').focus({preventScroll:true});}
}
function showResult(){
  if(state.mode==='duel'){showDuelResult();return;}
  if(resultShown)return;resultShown=true;clearControls();document.exitPointerLock?.();
  const won=state.status==='won';$('result').hidden=false;
  $('result-kicker').textContent=won?'MISSION COMPLETE':'SIGNAL LOST';
  $('result-title').textContent=won?'接続が、道をひらいた。':'もう一度、声をつなごう。';
  $('result-description').textContent=won?`${Math.floor(state.elapsed/60)}分${Math.floor(state.elapsed%60)}秒で帰還。コア ${state.collected}/4 · ドローン停止 ${state.kills}体`:`${state.reason} コア ${state.collected}/4。次は相棒と道順を相談しよう。`;
  $('retry').hidden=!solo&&!room?.isHost;
  $('retry').disabled=false;
  $('retry').textContent='もう一度プレイ';
}

function showDuelResult(){
  if(!resultShown){resultShown=true;clearControls();document.exitPointerLock?.();}
  $('result').hidden=false;
  const finished=state.status==='finished',winner=finished?state.winner:state.roundWinner;
  $('result-kicker').textContent=finished?'MATCH COMPLETE':`ROUND ${state.round} / ${ROUND_COUNT} COMPLETE`;
  $('result-title').textContent=winner?`${winner===slot[0]?'勝利！':'敗北'} UNIT ${winner.toUpperCase()}${finished?' が総合優勝':' がラウンド獲得'}`:'引き分け';
  const history=state.rounds.map(r=>`R${r.round}: ${r.winner?r.winner.toUpperCase():'DRAW'}`).join(' / ');
  const next=finished?(room?.isHost?'ホストが再戦を開始できます。':'ホストの再戦開始を待っています。'):room?.players.length<4?'接続待ち：4人そろうと次ラウンドへ進みます。':`${Math.ceil(state.intermission)}秒後にラウンド${state.round+1}開始。開始位置を交代します。`;
  $('result-description').textContent=`${state.reason}。A ${state.scores.a} : ${state.scores.b} B — ${history}。${next}`;
  $('retry').hidden=!finished||!room?.isHost;
  $('retry').disabled=room?.players.length!==4;
  $('retry').textContent='もう一度3ラウンド対戦';
}

function frame(now){
  const dt=Math.min((now-lastFrame)/1000,.05);lastFrame=now;
  if(inGame&&state){
    netElapsed+=dt;hudElapsed+=dt;
    if(solo||(room?.isHost&&room.players.length===4)){
      const inputs=room&&!solo?room.readInputs():{};inputs[slot]=readInput();step(state,inputs,dt);
    }
    if(!solo&&room){
      if(netElapsed>=.05){
        if(room.isHost)room.broadcastState(state);else room.sendInput(readInput());
        netElapsed=0;
      }
    }
    renderer.draw(state,slot);
    if(hudElapsed>=.1){updateHUD();hudElapsed=0;}
  }
  requestAnimationFrame(frame);
}

$('create-room').addEventListener('click',()=>connect(true));
$('join-form').addEventListener('submit',e=>{e.preventDefault();connect(false);});
$('leave-room').addEventListener('click',leaveRoom);
$('start-game').addEventListener('click',startMission);
$('practice').addEventListener('click',()=>enterGame(true));
$('switch-role').addEventListener('click',switchRole);
$('quit-game').addEventListener('click',()=>{exitGame();if(room)leaveRoom();});
$('retry').addEventListener('click',()=>{if(solo)enterGame(true);else startMission();});
$('signal-one').addEventListener('click',()=>sendSignal(0));$('signal-two').addEventListener('click',()=>sendSignal(1));
$('ping-button').addEventListener('click',sendPing);
$('copy-room').addEventListener('click',async()=>{
  if(!room)return;const url=new URL(location.href);url.searchParams.set('v','mqtt-1');url.hash=`room=${room.code}`;
  try{await navigator.clipboard.writeText(url.href);status('招待URLをコピーしました。3人に共有してください。');}catch{status(`コピーできませんでした。コード ${room.code} を共有してください。`);}
});
$('toggle-help').addEventListener('click',()=>{clearControls();document.exitPointerLock?.();$('help-dialog').showModal();});
$('help-dialog').addEventListener('close',()=>{$('viewport').focus({preventScroll:true});});
$('viewport').addEventListener('pointerdown',e=>{
  if(e.button!==0||!inGame||state?.status!=='playing')return;
  $('viewport').focus({preventScroll:true});
  if(slot.endsWith('upper')){
    if(document.pointerLockElement)mouseDown=true;
    else {const result=$('viewport').requestPointerLock?.();result?.catch?.(()=>{$('canvas-hint').textContent='矢印キーで上下左右の照準 / Spaceで射撃';});}
  }
});
document.addEventListener('pointerup',()=>{mouseDown=false;});
document.addEventListener('mousemove',e=>{
  if(inGame&&slot.endsWith('upper')&&document.pointerLockElement=== $('viewport')){
    lookDelta=Math.max(-.35,Math.min(.35,lookDelta+e.movementX*.0025));
    pitchDelta=Math.max(-.35,Math.min(.35,pitchDelta-e.movementY*.0025));
  }
});
document.addEventListener('pointerlockchange',()=>{mouseDown=false;updatePointerHint();});
document.addEventListener('keydown',e=>{
  if(!inGame||$('help-dialog').open)return;
  if(e.target instanceof HTMLButtonElement&&['Space','Enter'].includes(e.code))return;
  if(e.code==='Tab'&&solo){e.preventDefault();if(!e.repeat)switchRole();return;}
  if(e.code==='KeyG'){e.preventDefault();if(!e.repeat)sendPing();return;}
  if(['KeyW','KeyA','KeyS','KeyD','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','KeyQ','KeyE'].includes(e.code)){
    e.preventDefault();keys.add(e.code);if(!e.repeat&&e.code==='KeyQ')sendSignal(0);if(!e.repeat&&e.code==='KeyE')sendSignal(1);
  }
});
document.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',clearControls);document.addEventListener('visibilitychange',clearControls);
window.addEventListener('beforeunload',()=>room?.close());
requestAnimationFrame(frame);
