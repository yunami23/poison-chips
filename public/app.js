'use strict';
(()=>{
  const $ = id => document.getElementById(id);
  const E = {
    home: $('homeScreen'), game: $('gameScreen'), nickname: $('nickname'), roomInput: $('roomInput'),
    hint: $('entryHint'), board: $('chipBoard'), roomCode: $('roomCode'), score: $('scoreboard'),
    roundLabel: $('roundLabel'), statusLabel: $('statusLabel'), remaining: $('remainingCount'),
    legend: $('boardLegend'), phaseCount: $('phaseCount'), title: $('phaseTitle'), desc: $('phaseDesc'),
    pills: $('phasePills'), result: $('roundResult'), action: $('actionButton'), note: $('actionNote'),
    feed: $('activityFeed'), toast: $('toast')
  };
  let ws=null, game=null, draft=null, lastPhase='', currentMode='', desired=null, retryTimer=null, toastTimer=null;
  let session=null;
  try { session=JSON.parse(sessionStorage.getItem('poisonChipsRoom')||'null'); } catch {}
  const inviteCode=(new URLSearchParams(location.search).get('room')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
  if(inviteCode){E.roomInput.value=inviteCode;E.hint.textContent='朋友已经邀请你啦，输入昵称即可加入。';}
  try { E.nickname.value=session?.name || localStorage.getItem('poisonChipsName') || ''; } catch {}

  function freshId(){
    if(window.crypto?.randomUUID) return crypto.randomUUID().replaceAll('-','');
    const bytes=new Uint8Array(20);crypto.getRandomValues(bytes);return Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
  }
  function saveSession(s){session=s;try{sessionStorage.setItem('poisonChipsRoom',JSON.stringify(s));localStorage.setItem('poisonChipsName',s.name);}catch{}}
  function clearSession(){session=null;try{sessionStorage.removeItem('poisonChipsRoom');}catch{}}
  function tip(t){clearTimeout(toastTimer);E.toast.textContent=t;E.toast.classList.add('show');toastTimer=setTimeout(()=>E.toast.classList.remove('show'),3000)}
  function setURL(code){history.replaceState(null,'',location.pathname+(code?'?room='+encodeURIComponent(code):''));}
  function send(obj){if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify(obj));return true}tip('正在连接服务器，请稍后重试');return false}
  function openSocket(){
    if(ws && (ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))return;
    const proto=location.protocol==='https:'?'wss':'ws';
    ws=new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen=()=>{
      const req=desired||(session?{type:'join',code:session.code,name:session.name,playerId:session.playerId}:null);
      if(req)send(req);
      if(game)render();
    };
    ws.onmessage=e=>{
      let msg;try{msg=JSON.parse(e.data)}catch{return}
      if(msg.type==='error'){
        tip(msg.message||'操作失败'); E.hint.textContent=msg.message||'连接失败';
        if(msg.message?.includes('找不到这个房间')){
          clearSession();desired=null;game=null;showHome();setURL(inviteCode||'');
        }
      }
      if(msg.type==='joined'){
        const code=msg.code;
        const req=desired||session;
        if(req){saveSession({code,name:req.name,playerId:req.playerId});desired={type:'join',code,name:req.name,playerId:req.playerId};}
        setURL(code);E.roomCode.textContent=code;showGame();
      }
      if(msg.type==='state'){
        const next=msg.room;
        const phaseKey=`${next.round}-${next.phase}`;
        if(phaseKey!==lastPhase){draft=null;lastPhase=phaseKey;}
        game=next;showGame();render();
      }
    };
    ws.onclose=()=>{
      ws=null;if(game)render();
      if(desired||session){clearTimeout(retryTimer);retryTimer=setTimeout(openSocket,1800)}
    };
    ws.onerror=()=>{};
  }
  function showHome(){E.home.classList.remove('hidden');E.game.classList.add('hidden')}
  function showGame(){E.home.classList.add('hidden');E.game.classList.remove('hidden')}
  function enter(mode){
    const name=E.nickname.value.trim().slice(0,12);
    const code=E.roomInput.value.trim().toUpperCase().replace(/\s/g,'');
    if(!name){E.nickname.focus();tip('先给自己起个名字吧！');return}
    if(mode==='join' && !/^[A-Z0-9]{6}$/.test(code)){E.roomInput.focus();tip('请输入六位房间码');return}
    clearTimeout(retryTimer);
    const playerId=freshId();
    clearSession();
    desired={type:mode,playerId,name,...(mode==='join'?{code}:{})};
    E.hint.textContent='正在连接游戏服务器…';
    if(ws?.readyState===WebSocket.OPEN)send(desired);else openSocket();
  }
  $('createBtn').onclick=()=>enter('create');
  $('joinBtn').onclick=()=>enter('join');
  $('entryForm').onsubmit=e=>{e.preventDefault();enter(E.roomInput.value?'join':'create')};
  E.roomInput.addEventListener('input',()=>{E.roomInput.value=E.roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6)});
  $('copyInvite').onclick=async()=>{
    const code=game?.code||session?.code;if(!code)return;
    const u=new URL(location.href);u.searchParams.set('room',code);
    try{await navigator.clipboard.writeText(u.toString());tip('邀请链接已复制，发给朋友吧！')}
    catch{const input=document.createElement('textarea');input.value=u.toString();document.body.appendChild(input);input.select();try{document.execCommand('copy');tip('邀请链接已复制')}catch{tip('请手动复制浏览器网址')}input.remove()}
  };
  function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el}
  function playerMe(){return game?.players?.find(p=>p.id===game.selfId)}
  function otherPlayer(){return game?.players?.find(p=>p.id!==game.selfId)}
  function playerById(id){return game.players.find(p=>p.id===id)}
  function setAction(mode,label,disabled=false){currentMode=mode;E.action.disabled=disabled;E.action.textContent=label}
  function pill(text,cls=''){E.pills.appendChild(node('span','info-pill '+cls,text))}
  function renderScore(){
    E.score.replaceChildren();
    game.players.forEach((p,i)=>{
      const card=node('div','player-card '+(p.id===game.selfId?'is-self':''));
      const left=node('div');left.appendChild(node('div','player-role',p.id===game.selfId?'YOU · 本人':'RIVAL · 对手'));
      left.appendChild(node('div','player-name',p.name));
      const online=node('div','player-indicator'+(p.connected?'':' offline'));
      online.appendChild(node('i'));online.appendChild(document.createTextNode(p.connected?'在线':'暂时离线'));left.appendChild(online);
      const right=node('div','player-score');
      for(let n=0;n<2;n++)right.appendChild(node('span','score-bubble'+(p.wins>n?' won':''),p.wins>n?'★':'☆'));
      card.append(left,right);E.score.appendChild(card);
    });
  }
  function renderBoard(){
    E.board.replaceChildren();
    const after=game.phase==='reveal'||game.phase==='finished';
    const myTurn=game.phase==='pick' && game.turnId===game.selfId;
    const canTouch=(game.phase==='plant'&&game.selfPoison===null)||(myTurn&&game.players.every(p=>p.connected));
    for(let n=0;n<game.chips;n++){
      const isRemoved=game.removed.includes(n);
      const isOwn=game.selfPoison===n;
      const isDraft=draft===n;
      const isDanger=after&&game.lastResult?.pickedChip===n;
      const isPoisonRevealed=after&&game.lastResult?.poisons?.some(p=>p.chip===n);
      const classes=['chip',isRemoved?'is-removed':'',isOwn&&!after?'is-poison':'',isDraft&&game.phase==='plant'?'is-draft':'',isDraft&&game.phase==='pick'?'is-target':'',isDanger?'is-danger':'',isPoisonRevealed&&!isDanger?'is-highlight':''].filter(Boolean).join(' ');
      const b=node('button',classes);b.type='button';b.disabled=!canTouch||isRemoved;
      b.dataset.chip=n;b.setAttribute('aria-label',`第 ${n+1} 片薯片${isRemoved?'，已移除':''}${isOwn&&!after?'，自己设置的毒药':''}`);
      b.style.setProperty('--rot',`${((n*17+11)%39)-19}deg`);
      b.appendChild(node('span','chip-art'));
      b.appendChild(node('span','chip-num',String(n+1).padStart(2,'0')));
      if(isOwn&&!after)b.appendChild(node('span','chip-mark','☠'));
      if(after&&isPoisonRevealed&&!isDanger){const mark=node('span','chip-mark','☠');mark.style.display='grid';b.appendChild(mark)}
      b.onclick=()=>{draft=n;renderBoard();renderPanel()};
      E.board.appendChild(b);
    }
    E.remaining.textContent=game.remaining.length;
    E.legend.textContent=after?'揭晓啦！圈出的就是毒薯片':game.phase==='plant'?'红色骷髅只会显示在你这边':game.phase==='pick'?'当心！红色骷髅是你放的毒药':'对方的秘密永远看不到';
  }
  function renderPanel(){
    E.pills.replaceChildren();E.result.classList.add('hidden');E.result.replaceChildren();
    const me=playerMe(),other=otherPlayer();const host=game.players[0]?.id===game.selfId;
    const bothOnline=game.players.length===2&&game.players.every(p=>p.connected);
    E.roundLabel.textContent=game.round?String(game.round).padStart(2,'0'):'—';
    E.phaseCount.innerHTML=String(game.round||0).padStart(2,'0')+' <span>/ 03</span>';
    E.statusLabel.textContent=game.status==='lobby'?'等候好友':game.status==='finished'?'比赛结束':game.phase==='plant'?'偷偷埋雷':game.phase==='pick'?'生死一片': '揭晓时刻';
    E.note.textContent='记住：拿到「对方」放的毒药才会输';
    if(game.status==='lobby'){
      E.title.textContent=game.players.length===2?'两人到齐！':'等朋友入座';
      E.desc.textContent=game.players.length===2?'准备好了就开局。每个人先偷偷选一片毒薯片，对方看不到。':'分享右上方邀请链接，或者告诉朋友六位房间码。';
      pill(`${game.players.length}/2 人已入座`,'good');
      if(host)setAction('start','开始互坑 →',!bothOnline);else setAction('wait','等房主开始…',true);
      E.note.textContent='房主开始比赛 · 三局两胜';
    }else if(game.phase==='plant'){
      E.title.textContent=me.poisonLocked?'埋好雷了！':'偷偷指定毒薯片';
      E.desc.textContent=me.poisonLocked?'你的毒药已经锁定，等对方埋好雷就开始轮流拿。':'从桌上挑一片薯片。只有你自己能看到标记，确认后不能修改。';
      pill(me.poisonLocked?'你已埋雷 ✓':'你还没选','good');
      pill(other?.poisonLocked?'对方已埋雷 ✓':'对方还在挑');
      if(me.poisonLocked)setAction('wait','等待对方选好…',true);
      else setAction('plant',draft===null?'先点一片薯片':'确认下毒 · 第 '+(draft+1)+' 片 ☠',draft===null);
      E.note.textContent='🤫 下毒阶段，双方各自秘密操作';
    }else if(game.phase==='pick'){
      const myTurn=game.turnId===game.selfId;
      E.title.textContent=!bothOnline?'暂停：朋友掉线了':myTurn?'轮到你冒险！':'看对方敢不敢拿';
      E.desc.textContent=!bothOnline?'两人重新连接后继续，不会丢失本局进度。':myTurn?'挑一片薯片，确定后立刻揭晓安全还是中毒。':'对方正在选薯片。看着桌子上越来越少的薯片，别慌。';
      pill(myTurn?'你的回合':'对方的回合',myTurn?'warn':'');
      pill(`剩 ${game.remaining.length} 片`);
      if(!bothOnline)setAction('wait','等待朋友重新连接…',true);
      else if(myTurn)setAction('pick',draft===null?'选择一片拿走':'拿走第 '+(draft+1)+' 片 →',draft===null);
      else setAction('wait','等待对方选择…',true);
      E.note.textContent='安全就换对方 · 踩到对方的毒药立刻输';
    }else if(game.phase==='reveal'||game.phase==='finished'){
      const r=game.lastResult;const meWon=r?.winnerId===game.selfId;
      E.title.textContent=game.status==='finished'?(game.winnerId===game.selfId?'你是最终赢家！':'这次被坑惨了！'):(meWon?'漂亮！对方中毒！':'哎呀，你踩雷了！');
      E.desc.textContent=game.status==='finished'?'三局两胜已经分出胜负，准备好再次互坑了吗？':'本局已经揭晓。可以看看两个人究竟把毒药放在哪片薯片里。';
      pill(meWon?'你赢了这一局 🎉':'对方赢下这一局','good');
      const result=node('div');
      result.appendChild(node('b',meWon?'✷ 完美反杀！':'☠ 你被毒到了'));
      result.appendChild(node('p',`${r.loserName} 拿走了第 ${r.pickedChip+1} 片，那是 ${r.winnerName} 的毒薯片。`));
      if(r.poisons?.length===2){
        const a=r.poisons[0],b=r.poisons[1];
        result.appendChild(node('p',a.chip===b.chip?`你们居然都选了第 ${a.chip+1} 片！`:`埋雷位置：${playerById(a.id)?.name} → ${a.chip+1}号，${playerById(b.id)?.name} → ${b.chip+1}号。`));
      }
      E.result.append(...result.childNodes);E.result.classList.remove('hidden');
      if(game.status==='finished'){
        pill(`最终战绩 ${me.wins} : ${other.wins}`);
        setAction('rematch',me.rematchReady?'等对方同意再来…':'再来一场 ↗',me.rematchReady||!bothOnline);
        E.note.textContent=other?.rematchReady?'对方已经准备好重赛':'双方点击再来一场后自动开局';
      } else if(host){setAction('next','开始第 '+(game.round+1)+' 局 →',!bothOnline);E.note.textContent='房主负责开启下一局';}
      else{setAction('wait','等房主开启下一局…',true);E.note.textContent='三局两胜，先赢两局就获胜';}
    }
  }
  function renderFeed(){
    E.feed.replaceChildren();const items=game.history.slice(-5).reverse();
    if(!items.length){E.feed.appendChild(node('p','静待坏事发生……'));return}
    items.forEach(item=>E.feed.appendChild(node('p','',item.text)));
  }
  function render(){
    if(!game)return;
    E.roomCode.textContent=game.code;
    renderScore();renderBoard();renderPanel();renderFeed();
    if(ws?.readyState!==WebSocket.OPEN){E.statusLabel.textContent='正在重连…';E.action.disabled=true;}
  }
  E.action.onclick=()=>{
    if(!game)return;
    if(currentMode==='start')send({type:'start'});
    else if(currentMode==='plant'&&draft!==null){if(send({type:'plant',chip:draft})){draft=null;E.action.disabled=true}}
    else if(currentMode==='pick'&&draft!==null){if(send({type:'pick',chip:draft})){draft=null;E.action.disabled=true}}
    else if(currentMode==='next')send({type:'next'});
    else if(currentMode==='rematch')send({type:'rematch'});
  };
  if(session && (!inviteCode||session.code===inviteCode)){
    desired={type:'join',code:session.code,name:session.name,playerId:session.playerId};openSocket();
  } else if(session&&inviteCode&&session.code!==inviteCode)clearSession();
})();
