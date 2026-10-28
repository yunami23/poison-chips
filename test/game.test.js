'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const crypto = require('node:crypto');
const { join } = require('node:path');
const port = 17100 + crypto.randomInt(5000);
let server;
before(async () => {
  server = spawn(process.execPath, ['server.js'], { cwd: join(__dirname,'..'), env: { ...process.env, PORT: String(port) }, stdio:'pipe' });
  let ok=false;
  for(let i=0;i<80;i++) {
    try { const res=await fetch(`http://localhost:${port}/health`); if(res.ok){ok=true;break;} } catch {}
    await sleep(50);
  }
  assert.ok(ok,'server must become ready');
});
after(()=>server?.kill());

class Client {
  constructor(name){this.name=name;this.id=crypto.randomBytes(16).toString('hex');this.state=null;this.all=[];this.ws=null;}
  async connect(){
    this.ws=new WebSocket(`ws://localhost:${port}/ws`);
    this.ws.addEventListener('message',e=>{
      const m=JSON.parse(e.data);this.all.push(m);
      if(m.type==='state')this.state=m.room;
    });
    await new Promise((resolve,reject)=>{this.ws.addEventListener('open',resolve,{once:true});this.ws.addEventListener('error',reject,{once:true})});
  }
  send(type, extra={}){this.ws.send(JSON.stringify({type,...extra}))}
  wait(pred,why='wait for server state'){
    return new Promise((resolve,reject)=>{
      const deadline=Date.now()+2500;
      const check=()=>{
        if(pred(this.state,this.all)){resolve(this.state);return}
        if(Date.now()>deadline){reject(new Error(`${why}\nLast state: ${JSON.stringify(this.state)}`));return}
        setTimeout(check,12);
      };check();
    });
  }
  close(){this.ws?.close()}
}
async function room() {
  const a=new Client('甲'),b=new Client('乙');await Promise.all([a.connect(),b.connect()]);
  a.send('create',{playerId:a.id,name:a.name});
  await a.wait(s=>s?.status==='lobby'&&s.players.length===1,'create room');
  const code=a.state.code;
  b.send('join',{code,playerId:b.id,name:b.name});
  await Promise.all([a.wait(s=>s?.players.length===2),b.wait(s=>s?.players.length===2)]);
  a.send('start');await Promise.all([a.wait(s=>s?.phase==='plant'),b.wait(s=>s?.phase==='plant')]);
  return {a,b,code};
}
async function plant(a,b,ac,bc){
  a.send('plant',{chip:ac});await a.wait(s=>s?.players[0].poisonLocked);
  // The opponent must see only that one poison is set, not its location.
  await b.wait(s=>s?.players[0].poisonLocked);
  assert.equal(b.state.selfPoison,null);
  assert.ok(!JSON.stringify(b.state).includes('"poisons"'));
  b.send('plant',{chip:bc});
  await Promise.all([a.wait(s=>s?.phase==='pick'),b.wait(s=>s?.phase==='pick')]);
}
async function chooseNextRound(a,b){
  a.send('next');await Promise.all([a.wait(s=>s?.phase==='plant'),b.wait(s=>s?.phase==='plant')]);
}
test('serves web assets correctly',async()=>{
  for(const route of ['/', '/app.js', '/style.css', '/favicon.svg', '/health']){
    const r=await fetch(`http://localhost:${port}${route}`);assert.equal(r.status,200,`${route} should return 200`);
  }
  const r=await fetch(`http://localhost:${port}/does-not-exist`);assert.equal(r.status,404);
});
test('players choose secret poisons; wrong turn does not remove a chip; picking enemy poison loses',async()=>{
  const {a,b}=await room();
  try{
    await plant(a,b,4,11);
    assert.equal(a.state.selfPoison,4);
    assert.equal(b.state.selfPoison,11);
    const whose=a.state.turnId===a.id?a:b;
    const waiting=whose===a?b:a;
    waiting.send('pick',{chip:1});await sleep(80);
    assert.equal(a.state.remaining.length,20,'out-of-turn choice ignored');
    const lethal=whose===a?11:4;
    whose.send('pick',{chip:lethal});
    await Promise.all([a.wait(s=>s?.phase==='reveal'),b.wait(s=>s?.phase==='reveal')]);
    assert.equal(a.state.lastResult.loserId,whose.id);
    assert.equal(a.state.lastResult.poisons.length,2);
    assert.equal(a.state.players.find(p=>p.id===waiting.id).wins,1);
  }finally{a.close();b.close()}
});
test('safe draw advances turn; taking your own poison is safe if different',async()=>{
  const {a,b}=await room();
  try{
    await plant(a,b,5,14);
    const first=a.state.turnId===a.id?a:b;const other=first===a?b:a;
    const own=first.state.selfPoison;
    first.send('pick',{chip:own});
    await Promise.all([a.wait(s=>s?.remaining.length===19),b.wait(s=>s?.remaining.length===19)]);
    assert.equal(a.state.phase,'pick');assert.equal(a.state.turnId,other.id);
    assert.ok(!a.state.remaining.includes(own));
  }finally{a.close();b.close()}
});
test('best-of-three ends after 2 wins and requires both players for rematch',async()=>{
  const {a,b}=await room();
  try{
    await plant(a,b,0,1);
    let first=a.state.turnId===a.id?a:b;
    first.send('pick',{chip:first===a?1:0});
    await a.wait(s=>s?.phase==='reveal');
    const firstLoser=first.id;const firstWinner=first===a?b:a;
    await chooseNextRound(a,b);
    await plant(a,b,2,3);
    // Ensure same winner in second round: arrange loser to lose on their turn.
    const secondFirst=a.state.turnId===a.id?a:b;
    if(secondFirst.id!==firstLoser){
      secondFirst.send('pick',{chip:4});await a.wait(s=>s?.remaining.length===19);
    }
    const loser=firstLoser===a.id?a:b;
    loser.send('pick',{chip:firstLoser===a.id?3:2});
    await a.wait(s=>s?.status==='finished');
    assert.equal(a.state.winnerId,firstWinner.id);
    assert.equal(a.state.players.find(p=>p.id===firstWinner.id).wins,2);
    a.send('rematch');await a.wait(s=>s?.players[0].rematchReady);
    assert.equal(a.state.status,'finished');
    b.send('rematch');await a.wait(s=>s?.round===1&&s?.phase==='plant');
    assert.deepEqual(a.state.players.map(p=>p.wins),[0,0]);
  }finally{a.close();b.close()}
});
test('player reconnects with private identity and preserves the game',async()=>{
  const {a,b,code}=await room();
  try{
    await plant(a,b,6,18);
    b.close();await a.wait(s=>s?.players[1].connected===false);
    const b2=new Client(b.name);b2.id=b.id;await b2.connect();
    b2.send('join',{code,playerId:b2.id,name:b2.name});
    await a.wait(s=>s?.players[1].connected===true);
    await b2.wait(s=>s?.phase==='pick');
    assert.equal(b2.state.selfPoison,18);
    assert.equal(b2.state.remaining.length,20);
    b2.close();
  }finally{a.close();b.close()}
});
