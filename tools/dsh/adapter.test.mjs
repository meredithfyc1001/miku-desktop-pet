import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readAllConfig, flattenPetList } from '../upstream/dsh-pet/dsh-pet/src/host/config.ts';
import { squashScale } from '../upstream/dsh-pet/dsh-pet/src/shared/physics/squash.ts';
import { collectReadyPreviews, selectActiveClips, verifyPreviewReport } from './preview-assets.mjs';
import { loadSymphony } from './symphony.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const runtime=join(root,'integrations/dsh/runtime');
const ffmpeg=join(root,'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const {normalizeCodexQuota}=createRequire(import.meta.url)('./codex-quota.cjs');
const {loadPreferences, savePreferences}=createRequire(import.meta.url)('./miku-preferences.cjs');
const {createStatusMonitor}=createRequire(import.meta.url)('./miku-codex-status.cjs');

test('Codex status baselines old completions and celebrates only a fresh successful idle transition',()=>{
  let now=1_800_000_005_000;
  const turn=(thread_id, status, completed_at=null)=>({thread_id,turn_id:'one',status,completed_at,
    started_at:Math.floor(now/1000)-10});
  const old=turn('old','completed',Math.floor(now/1000)-1);
  const events=[];
  let rows=[old];
  const monitor=createStatusMonitor({read:()=>rows,publish:event=>events.push(event),clock:()=>now});
  const tick=(next,kind)=>{
    now+=3000;
    rows=next;
    monitor.tick();
    assert.equal(events.at(-1).kind,kind);
  };
  monitor.setEnabled(true);
  try{
    assert.equal(events.at(-1).kind,'idle');
    tick([old,turn('a','inProgress'),turn('b','inProgress')],'working');
    const working=events.at(-1).id;
    tick([turn('a','completed',now/1000),turn('b','inProgress')],'working');
    assert.equal(events.at(-1).id,working);
    tick([turn('b','interrupted',now/1000)],'idle');
    tick([turn('c','inProgress')],'working');
    const completed=turn('c','completed',now/1000);
    tick([completed],'completed');
    const celebration=events.at(-1).id;
    tick([completed],'completed');
    assert.equal(events.at(-1).id,celebration);
    now+=45_000;
    tick([],'idle');
  }finally{monitor.setEnabled(false);}
});

test('Settings preserve earlier choices and reject invalid changes without writing',()=>{
  const home=mkdtempSync(join(tmpdir(),'miku-settings-test-'));
  try {
    const defaults={idle:88,turn:3,move:3};
    assert.deepEqual(loadPreferences(home),{});
    savePreferences(home,{whisper:15, topmost:false},defaults);
    savePreferences(home,{idle:40, turn:30, move:20, size:419.33, appearance:'symphony'},defaults);
    const saved={whisper:15,topmost:false,idle:40,turn:30,move:20,size:419.33,appearance:'symphony'};
    assert.deepEqual(loadPreferences(home),saved);
    assert.throws(()=>savePreferences(home,{turn:50},defaults),/100%/);
    assert.throws(()=>savePreferences(home,{size:10000},defaults),/范围/);
    assert.throws(()=>savePreferences(home,{appearance:'unknown'},defaults),/范围/);
    assert.throws(()=>savePreferences(home,{symphonyIdleStyle:'unknown'},defaults),/范围/);
    assert.deepEqual(loadPreferences(home),saved);
    for(const style of ['front','ballet']){
      writeFileSync(join(home,'miku-preferences.json'),JSON.stringify({...saved,symphonyIdleStyle:style,
        favorites:['正面站姿待机','提裙致意','站久了，放松一下']}));
      const migrated={...saved,favorites:['站久了，放松一下','提裙致意']};
      assert.deepEqual(loadPreferences(home),migrated);
      savePreferences(home,{size:419.33},defaults);
      assert.deepEqual(JSON.parse(readFileSync(join(home,'miku-preferences.json'),'utf8')),migrated);
    }
  } finally {
    rmSync(home,{recursive:true,force:true});
  }
});

test('Previews require review of the exact media, the current reference and valid frame counts',()=>{
  const report={candidateSha256:'CANDIDATE',referenceSha256:'REFERENCE',frames:241,width:640,height:360};
  const review={status:'passed',candidateSha256:'CANDIDATE'};
  assert.doesNotThrow(()=>verifyPreviewReport(report,'CANDIDATE','REFERENCE',review));
  assert.throws(()=>verifyPreviewReport(report,'CHANGED','REFERENCE',review));
  assert.throws(()=>verifyPreviewReport(report,'CANDIDATE','CHANGED',review));
  assert.throws(()=>verifyPreviewReport({...report,frames:0},'CANDIDATE','REFERENCE',review));
  assert.throws(()=>verifyPreviewReport({...report,width:641},'CANDIDATE','REFERENCE',review));
  assert.throws(()=>verifyPreviewReport(report,'CANDIDATE','REFERENCE',undefined));
  assert.throws(()=>verifyPreviewReport(report,'CANDIDATE','REFERENCE',{...review,status:'failed'}));
  assert.throws(()=>verifyPreviewReport(report,'CANDIDATE','REFERENCE',{...review,candidateSha256:'OTHER'}));
});


test('The tray exposes only Miku, and its exit action quits the trial',async()=>{
  const {createTray}=createRequire(import.meta.url)(join(runtime,'runtime/electron-helper/main/tray.js'));
  let template,quit=false;
  class Tray{setToolTip(){}setContextMenu(value){template=value;}}
  const icon={isEmpty:()=>false,resize(){return this;}};
  const merged={main:{pets:[{id:'main',name:'Hidden default',display:'none'}]},miku:{pets:[{id:'miku',name:'Miku',display:'desktop'}]}};
  const tray=createTray({app:{quit(){quit=true;}},Tray,Menu:{buildFromTemplate:t=>t},nativeImage:{createFromPath:()=>icon},hostRequest:async()=>({body:JSON.stringify(merged)}),callbackUrl:()=>'',isBridge:false,appMode:true,petRoute:'/dsh-pet-7340',platform:{},helperDir:join(runtime,'runtime/electron-helper')});
  await tray.start();assert.deepEqual(template.filter(t=>t.type==='checkbox').map(t=>t.label),['Miku']);
  template.find(t=>t.label==='退出').click();assert.equal(quit,true);
});

test('Miku pack uses its own complete animation pool, preferences and three sleep phases',()=>{
  const data=join(root,'data-dsh/dsh-pet');
  const merged=readAllConfig({defaultFile:join(runtime,'assets/config.jsonc'),userFile:join(data,'main-config.jsonc'),petDir:join(data,'pet')});
  const pets=flattenPetList(merged);
  assert.deepEqual(pets.filter(p=>p.display==='desktop'||p.display==='both').map(p=>p.id),
    pets.some(p=>p.id==='miku'&&(p.display==='desktop'||p.display==='both'))?['miku']:[]);
  const defaultPack=JSON.parse(readFileSync(join(root,'integrations/dsh/pack/miku-config.json'),'utf8'));
  assert.equal(defaultPack.pets.find(p=>p.id==='miku')?.display,'desktop');
  const conf=merged.miku;
  assert.equal(pets.find(p=>p.id==='miku')?.whisperEnabled,false);
  assert.equal(merged.main.clickSoundEnabled,false);
  assert.equal(merged.main.voiceEnabled,false);
  const a=conf.animations;
  const names=new Set([...a.idle,...a.turn,...a.drag,...a.clicks,...a.moves.actions.map(p=>p.name),...a.categories.flatMap(p=>p.actions),...a.sleep.flatMap(s=>[...s.start,...s.loop,...s.end])]);
  for(const name of names)assert.ok(existsSync(join(data,'pet/miku-animation',name+'.webm')),name);
  assert.equal(a.sleep[0].loop[0],'睡梦中');assert.equal(a.drag[0],'悬空轻晃');
});

function loadRuntime(){
  let now=0,queued=[];
  const window={matchMedia:()=>({matches:false}),setTimeout:()=>1,clearTimeout:()=>{},__dshPetDebug:{}};
  const context={PetSprite:function(){},S:{SQ_SQUASH:.55,SQ_DURATION_MS:220,squashScale},window,OPEN_TARGET:'standalone',OPEN_SHORTCUT_HINT:'',performance:{now:()=>now},requestAnimationFrame:f=>{queued.push(f);return 1;},cancelAnimationFrame:()=>{},console};
  vm.createContext(context);
  for(const file of ['init.js','playback.js','motion.js','menu.js'])vm.runInContext(readFileSync(join(runtime,'runtime/electron-helper/sprite',file),'utf8'),context);
  for(const file of ['miku-whisper.js','miku-quota.js','miku-actions-sprite.js'])vm.runInContext(readFileSync(join(runtime,'runtime/electron-helper',file),'utf8'),context);
  return {prototype:context.PetSprite.prototype,window,shared:context.S,context,advance(t){now=t;const q=queued;queued=[];q.forEach(f=>f());}};
}
test('The action menu has one entry per action and uses the selected reviewed assets',()=>{
  const previews=collectReadyPreviews(root);
  const r=loadRuntime();let tree,played,moved;
  Object.assign(r.shared,{buildMemeBranch:()=>null,displayMenuBranch:()=>({label:'display'}),buildMoreBranch:()=>null,buildMenuTree:()=>[{label:'动作',children:[]}],mountContextMenu:options=>{tree=options.tree;return{close(){}};},isNoMirrorAnimation:()=>false});
  const config=JSON.parse(readFileSync(join(root,'data-dsh/dsh-pet/pet/miku-config.json'),'utf8'));
  const p={assetRoot:'miku',pet:{},animations:config.animations,dragState:{},sleeping:false,frozen:false,facing:'left',stopThrow(){},stopMove(){},setInteractive(){},syncInputBusy(){},syncInputRegions(){},visibleClampRect:()=>({}),closeMenu(){},playOnce(name){played=name;},tryMove(name){moved=name;return name;},mikuWhisperMenu:r.prototype.mikuWhisperMenu};
  r.prototype.initPlayback.call(p,config);
  r.prototype.onContextMenu.call(p,{preventDefault(){},clientX:100,clientY:100});
  assert.deepEqual(Array.from(tree,item=>item.label),['待办事项','睡觉','回到初始位置','碎碎念','查看 Codex 额度','动作','动作图鉴','切换形象','桌宠设置','退出桌宠']);
  assert.deepEqual(Array.from(tree.find(item=>item.label==='碎碎念').children,item=>item.label),
    ['说一句','自动碎碎念（关闭）','模型设置']);
  const groups=tree.find(item=>item.label==='动作').children;
  const leaves=groups.flatMap(group=>group.children);
  const activeClips=selectActiveClips(previews);
  const ui=join(runtime,'runtime/electron-helper');
  const catalog=JSON.parse(readFileSync(join(ui,'miku-action-catalog.json'),'utf8'));
  assert.deepEqual(catalog.map(action=>action.name).sort(),activeClips.map(clip=>clip.target).sort());
  for(const action of catalog){
    assert.ok(existsSync(join(ui,'miku-action-posters',action.poster)),action.name);
    assert.ok(action.seconds>0);
  }
  const clickActions=activeClips.filter(clip=>clip.clickAction).map(clip=>clip.target);
  assert.deepEqual(Array.from(p.animations.clicks),[...new Set([...config.animations.clicks,...clickActions])]);
  const lifeActions=activeClips.filter(clip=>clip.lifeAction).map(clip=>clip.target);
  const lifeGroup=groups.find(group=>group.label==='生活趣味');
  assert.deepEqual(Array.from(lifeGroup?.children??[],item=>item.anim),lifeActions);
  assert.equal(Boolean(lifeGroup),lifeActions.length>0);
  const quotaActions=activeClips.filter(clip=>clip.quotaTier).map(clip=>clip.target);
  const quotaGroup=groups.find(group=>group.label==='额度动作');
  assert.deepEqual(Array.from(quotaGroup?.children??[],item=>item.anim),quotaActions);
  assert.equal(Boolean(quotaGroup),quotaActions.length>0);
  assert.equal(new Set(leaves.map(item=>item.anim)).size,leaves.length);
  for(const name of ['左右张望','散步一下','悬空轻晃','轻快舞步','开心摇摆','撑伞致意']){
    assert.ok(leaves.some(item=>item.label===name),name);
  }
  for(const clip of activeClips){
    const actual=join(root,'data-dsh/dsh-pet/pet/miku-animation',clip.target+'.webm');
    assert.ok(readFileSync(actual).equals(readFileSync(clip.source)),`${clip.target} does not match the reviewed video`);
    if(clip.quotaTier){
      r.prototype.playMikuQuotaReaction.call({...p,clearMikuQuotaProp(){}},clip.quotaTier);
      assert.equal(played,clip.target);
    }
    if(['打个盹','睡梦中','慢慢醒来'].includes(clip.target)){
      assert.ok(!leaves.some(item=>item.anim===clip.target),`${clip.target} should play through the sleep controls`);
      continue;
    }
    const entry=leaves.find(item=>item.label===clip.target);
    assert.ok(entry,clip.target);
    r.prototype.onMenuAction.call(p,entry);
    const isMove=config.animations.moves.actions.some(action=>action.name===clip.target);
    assert.equal(isMove?moved:played,clip.target);
  }
  assert.ok(!JSON.stringify(tree).includes('样片'));
  assert.ok(!config.animations.moves.actions.some(move=>move.name==='原地踏步'));
  if(previews.some(clip=>clip.action==='flow-nod')){
    assert.equal(selectActiveClips(previews).find(clip=>clip.target==='打个招呼').action,'flow-nod');
  }
});

test('The Symphony action menu and catalog stay within the selected appearance',async()=>{
  const symphony=loadSymphony(root);
  const r=loadRuntime();
  let tree;
  Object.assign(r.shared,{
    buildMemeBranch:()=>null,displayMenuBranch:()=>({label:'display'}),buildMoreBranch:()=>null,
    buildMenuTree:()=>[],mountContextMenu:options=>{tree=options.tree;return{close(){}};},
  });
  const p={
    assetRoot:'miku',pet:{mikuAppearance:'symphony',mikuActionNames:new Set(symphony.names)},
    dragState:{},sleeping:false,frozen:false,facing:'left',stopThrow(){},stopMove(){},setInteractive(){},
    syncInputBusy(){},syncInputRegions(){},visibleClampRect:()=>({}),closeMenu(){},
    mikuWhisperMenu:r.prototype.mikuWhisperMenu,
  };
  r.prototype.initPlayback.call(p,{...p.pet,animations:symphony.animations});
  r.prototype.onContextMenu.call(p,{preventDefault(){},clientX:100,clientY:100});
  assert.deepEqual(Array.from(tree.find(item=>item.label==='切换形象').children, item=>item.label),
    ['○ 未来有你 2021','● 交响乐 2020']);
  const relax='站久了，放松一下';
  assert.ok(!tree.some(item=>item.label==='待机姿势'));
  assert.deepEqual(symphony.animations.idle,['交响乐待机']);
  const groups=tree.find(item=>item.label==='动作').children;
  const names=Array.from(groups,group=>Array.from(group.children,leaf=>leaf.anim)).flat();
  assert.ok(!names.includes('正面站姿待机'));
  assert.equal(names.filter(name=>name===relax).length,1);
  assert.ok(Array.from(groups.find(group=>group.label==='日常').children,leaf=>leaf.anim).includes(relax));
  assert.equal(symphony.animations.categories.flatMap(group=>group.actions).filter(name=>name===relax).length,1);
  assert.ok(symphony.animations.categories.find(group=>group.id==='日常').actions.includes(relax));
  assert.ok(names.includes('交响乐待机'));
  assert.ok(names.includes('提裙致意'));
  assert.ok(names.every(name=>symphony.names.includes(name)));
  const quotaNames=Object.values(symphony.quota);
  assert.deepEqual(symphony.animations.events.balance,quotaNames);
  const quotaGroup=tree.find(item=>item.label==='动作').children.find(group=>group.label==='额度动作');
  assert.deepEqual(Array.from(quotaGroup?.children??[],leaf=>leaf.anim),quotaNames);
  const reactions=[];
  const quotaPet={
    pet:{mikuAppearance:'symphony',mikuQuotaActions:symphony.quota},
    clearMikuQuotaProp(){},playOnce(name){reactions.push(name);},
  };
  for(const tier of ['full','normal','low','empty']) r.prototype.playMikuQuotaReaction.call(quotaPet,tier);
  assert.deepEqual(reactions,quotaNames);
  const ui=join(runtime,'runtime/electron-helper');
  const catalog=JSON.parse(readFileSync(join(ui,'miku-symphony-catalog.json'),'utf8'));
  assert.deepEqual(catalog.map(action=>action.name).sort(),symphony.names.toSorted());
  assert.deepEqual(catalog.filter(action=>action.name===relax).map(action=>action.category),['日常']);
  assert.ok(!existsSync(join(root,'data-dsh/dsh-pet/pet/miku-animation/正面站姿待机.webm')));
  for(const clip of symphony.clips){
    const actual=join(root,'data-dsh/dsh-pet/pet/miku-animation',clip.target+'.webm');
    assert.ok(readFileSync(actual).equals(readFileSync(clip.source)),clip.target);
  }
});

test('A fast double click plays a favorite once without an extra click reaction',()=>{
  const r=loadRuntime();
  let deferred;
  r.window.setTimeout=callback=>{deferred=callback;return 1;};
  r.window.clearTimeout=()=>{deferred=undefined;};
  r.shared.pick=names=>names[0];
  const played=[];
  const pet=Object.assign(Object.create(r.prototype),{
    pet:{mikuFavorites:['看丝带']},dragState:{},stopMove(){},playOnce(name){played.push(name);},
  });
  const respond=()=>played.push('正常回应');
  pet.playMikuClick(1,respond);
  pet.playMikuClick(2,respond);
  assert.deepEqual(played,['看丝带']);
  assert.equal(deferred,undefined);
  pet.playMikuClick(1,respond);
  deferred();
  assert.deepEqual(played,['看丝带','正常回应']);
  pet.sleeping=true;
  assert.equal(pet.playMikuCatalogAction('看丝带'),false);
});

test('Codex quota reads only the main Codex bucket and keeps unknown limits distinct from zero',()=>{
  const primary={windowDurationMins:300,usedPercent:30,resetsAt:1800000000};
  const secondary={windowDurationMins:10080,usedPercent:100,resetsAt:null};
  const other={limitId:'other',primary:{...primary,usedPercent:100}};
  assert.deepEqual(normalizeCodexQuota({rateLimits:other,rateLimitsByLimitId:{codex:{primary,secondary}}}),[
    {minutes:300,remaining:70,resetsAt:1800000000},
    {minutes:10080,remaining:0,resetsAt:null},
  ]);
  assert.deepEqual(normalizeCodexQuota({rateLimits:other}),[]);
  assert.deepEqual(normalizeCodexQuota({rateLimits:{primary:{...primary,usedPercent:null},secondary:null}}),[]);
});

test('Codex quota uses the stricter window and distinguishes nearly depleted from exhausted',async()=>{
  const r=loadRuntime(), bubbles=[], reactions=[];
  let reply, calls=0;
  r.window.petBridge={readCodexQuota:async()=>{calls++;return reply;}};
  const pet=Object.assign(Object.create(r.prototype),{
    assetRoot:'miku',el:{isConnected:true},dragState:{},closeMenu(){},stopMove(){},
    showWhisper:(text,_image,_url,_duration,_anim,quota)=>{assert.ok(quota);bubbles.push(text);},
    playMikuQuotaReaction:tier=>reactions.push(tier),
  });
  for(const [remaining,tier] of [[70,'full'],[69,'normal'],[30,'normal'],[29,'low'],[10,'low'],[9,'empty'],[0,'empty']]){
    reply={status:'ok',windows:[{minutes:300,remaining:80,resetsAt:null},{minutes:10080,remaining,resetsAt:null}]};
    const checking=pet.onMenuAction({action:'miku-codex-quota'});
    assert.equal(await pet.onMenuAction({action:'miku-codex-quota'}),false);
    assert.equal(await checking,true);
    assert.equal(reactions.at(-1),tier);
    assert.match(bubbles.at(-1),new RegExp('7 天 剩 '+remaining+'%'));
    assert.equal(bubbles.at(-1).includes('额度已用完'),remaining===0);
    assert.equal(bubbles.at(-1).includes('额度快用完了'),remaining===9);
  }
  assert.equal(calls,7);
  reply={status:'unavailable'};
  assert.equal(await pet.onMenuAction({action:'miku-codex-quota'}),false);
  assert.match(bubbles.at(-1),/暂时查不到/);
  assert.equal(reactions.length,7);
});
test('Miku whispers fall back offline, honor the interval, and discard replies while busy',async()=>{
  const r=loadRuntime(), shown=[], requests=[], timers=new Map(), settings=new Map();
  let timerId=0, resolveModel;
  Object.assign(r.window,{setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);}});
  Object.assign(r.context,{BASE:'http://localhost/pet',AbortController,
    localStorage:{getItem:key=>settings.get(key),setItem:(key,value)=>settings.set(key,value)},
    fetch:(url,options)=>{requests.push({url,options});return new Promise(resolve=>{resolveModel=resolve;});}});
  r.shared.pick=(pool,excluded)=>pool.find(line=>line!==excluded);
  const pet=Object.assign(Object.create(r.prototype),{assetRoot:'miku',pet:{id:'miku'},dragState:{},anim:'待机眨眼',
    animations:{idle:['待机眨眼']},closeMenu(){},showWhisper:(text)=>shown.push(text),playOnce(){}});
  pet.initMikuWhisper();
  assert.equal(timers.size,0);
  const manual=pet.onMenuAction({action:'miku-whisper'});
  assert.match(requests.at(-1).url,/delivery=miku$/);
  assert.equal(await pet.sayMikuWhisper(),false);
  resolveModel({ok:false});
  assert.equal(await manual,true);
  assert.match(shown[0],/今天的风/);
  pet.setMikuWhisperInterval(5);
  assert.equal([...timers.values()][0].ms,300000);
  const automatic=[...timers.values()][0].fn();
  assert.match(requests.at(-1).url,/delivery=miku-auto$/);
  resolveModel({ok:true,json:async()=>({ok:true,text:'等风的时候，我会哼一小段旋律。'})});
  await automatic;
  assert.equal(shown[1],'等风的时候，我会哼一小段旋律。');
  const delayed=pet.sayMikuWhisper();
  pet.dragState.active=true;
  resolveModel({ok:true,json:async()=>({ok:true,text:'拖动时不要显示。'})});
  assert.equal(await delayed,false);
  pet.dragState.active=false;
  pet.sleeping=true;
  assert.equal(await pet.sayMikuWhisper(true),false);
  assert.equal(shown.length,2);
  pet.disposeMikuWhisper();
  pet.initMikuWhisper();
  assert.equal(pet.mikuWhisper.minutes,5);
  pet.setMikuWhisperInterval(0);
  assert.equal(pet.mikuWhisper.timer,null);
  pet.disposeMikuWhisper();
});
test('The Flow idle sample has no floating marks in its outer margins',async t=>{
  const source=join(root,'assets/video-production/revised/flow-idle/aligned-candidate.webm');
  const meta=join(root,'assets/video-production/revised/flow-idle/alignment-report.json');
  if(!existsSync(source)||!existsSync(meta)){t.skip('No AI sample is available');return;}
  const expected=JSON.parse(readFileSync(meta,'utf8')).frames;
  const process=spawn(ffmpeg,['-v','error','-c:v','libvpx-vp9','-i',source,'-f','rawvideo','-pix_fmt','rgba','pipe:1']);
  let err='';process.stderr.on('data',v=>{err+=v.toString();});
  const done=new Promise((resolve,reject)=>{process.once('error',reject);process.once('close',resolve);});
  const width=640,height=360,bytes=width*height*4;let pending=Buffer.alloc(0),frames=0,outer=0;
  for await(const chunk of process.stdout){
    pending=pending.length?Buffer.concat([pending,chunk]):chunk;
    while(pending.length>=bytes){
      const frame=pending.subarray(0,bytes);pending=pending.subarray(bytes);
      for(let y=0;y<height;y++){
        for(let x=0;x<150;x++)if(frame[(y*width+x)*4+3]>=64)outer++;
        for(let x=490;x<width;x++)if(frame[(y*width+x)*4+3]>=64)outer++;
      }
      frames++;
    }
  }
  assert.equal(await done,0,err);assert.equal(pending.length,0);assert.equal(frames,expected);
  assert.equal(outer,0,'Visible detached pixels were found in the outer margins');
});
test('AI previews retain their original source and any AIGC provenance metadata',t=>{
  const previews=collectReadyPreviews(root);
  if(!previews.length){t.skip('No AI sample is available');return;}
  const provenance=path=>{
    const result=spawnSync(ffmpeg,['-hide_banner','-i',path,'-t','0','-f','null','-'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const line=result.stderr.match(/^\s*AIGC\s*:\s*(.+)$/mi)?.[1];
    return line ? JSON.parse(line) : null;
  };
  for(const preview of previews){
    const source=join(root,'assets/video-production/revised',preview.action,'source.mp4');
    assert.ok(existsSync(source),preview.name+' source');
    const inspection=JSON.parse(readFileSync(join(root,'assets/video-production/revised',preview.action,'inspection.json'),'utf8'));
    assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex').toUpperCase(),inspection.inputSha256,preview.name+' original source hash');
    const sourceProvenance=provenance(source);
    assert.deepEqual(provenance(preview.source),sourceProvenance,preview.name);
  }
});
test('Quit Miku works even while the pet is asleep',()=>{
  const r=loadRuntime();let called=0;
  r.window.petBridge={quitMiku(){called++;}};
  r.prototype.onMenuAction.call({assetRoot:'miku',sleeping:true,frozen:false,closeMenu(){}},{action:'miku-quit'});
  assert.equal(called,1);
});
test('Idle advances the random action chain even when it is also the balance animation',()=>{
  const r=loadRuntime();let advanced=false;
  r.shared.isEventAnim=()=>true;
  const pet={assetRoot:'miku',anim:'待机眨眼',sleeping:false,dragState:{active:false},frozen:false,
    animations:{idle:['待机眨眼'],turn:[],drag:[],clicks:[],events:{balance:['待机眨眼']}},
    playIdle(){advanced=true;}};
  r.prototype.handleEnded.call(pet);
  assert.equal(advanced,true);
});
test('Miku click recoil stays gentle and never mirrors its umbrella, including facing right',()=>{
  const r=loadRuntime(),el={style:{}};
  const pet={assetRoot:'miku',facing:'right',squashToken:0,squashRef:null};
  r.prototype.startSquash.call(pet,el);
  r.advance(99);
  assert.ok(!el.style.transform.includes('scaleX'));
  assert.ok(Number(el.style.transform.match(/scaleY\(([^)]+)/)[1])>=.9);
  r.advance(220);assert.equal(el.style.transform,'');
});
test('Dragging loops its suspended pose; normal one-shot gestures still end',async()=>{
  const r=loadRuntime();
  const video=()=>({style:{},classList:{add(){},remove(){}},readyState:2,load(){},pause(){},play:()=>Promise.resolve(),addEventListener(){},removeEventListener(){}});
  for(const dragging of [true,false]){
    const pet={assetRoot:'miku',assetBase:'/thumb/miku/',facing:'right',front:0,gen:0,pending:null,videoA:video(),videoB:video(),dragState:{dragging},animations:{drag:['悬空轻晃']},handleEnded(){},reportPlayback(){}};
    r.prototype.switchTo.call(pet,'悬空轻晃',true);
    assert.equal(pet.videoB.loop,dragging);
    assert.equal(pet.videoB.style.transform,'');
  }
});
for (const [appearance,idle,turn] of [
  ['symphony','交响乐待机','八音盒旋转'], ['classic','待机眨眼','左右张望'],
]) test(appearance+' idle keeps its playing video across a loop and can advance to another action',()=>{
  const r=loadRuntime();
  const playback=r.prototype.switchTo;
  const video=()=>({
    currentTime:0,duration:9,style:{},classList:{add(){},remove(){}},readyState:2,
    load(){this.loads=(this.loads??0)+1;},
    pause(){},play:()=>Promise.resolve(),addEventListener(){},removeEventListener(){},
  });
  let rounds=0;
  const pet={
    assetRoot:'miku',pet:{mikuAppearance:appearance,mikuActionNames:new Set([idle,turn])},
    assetBase:'/thumb/miku/',front:0,gen:0,pending:null,videoA:video(),videoB:video(),
    dragState:{dragging:false},animations:{idle:[idle],drag:[]},reportPlayback(){},
    handleEnded(){playback.call(this,++rounds===1?idle:turn,true);},
  };
  playback.call(pet,idle,true);
  assert.equal(pet.videoB.loop,true);
  assert.equal(pet.videoB.onended,null);
  const wrap=()=>{
    pet.videoB.currentTime=8.9;pet.videoB.ontimeupdate();
    pet.videoB.currentTime=.08;pet.videoB.ontimeupdate();
  };
  wrap();
  assert.equal(rounds,1);
  assert.equal(pet.front,1);
  assert.equal(pet.videoB.loads,1);
  wrap();
  assert.equal(rounds,2);
  assert.equal(pet.front,0);
  assert.equal(pet.videoA.loop,false);
  assert.equal(pet.videoB.ontimeupdate,null);
  playback.call(pet,idle,true,'explicit-playback');
  assert.equal(pet.videoB.loop,false);
  assert.equal(typeof pet.videoB.onended,'function');
});
test('Superseded and failed Miku loads cannot change the current gesture or its error handler',()=>{
  const r=loadRuntime(), handlers=[];
  const video=()=>({readyState:0,style:{},classList:{add(){},remove(){}},load(){},pause(){},
    addEventListener:(_event,handler)=>handlers.push(handler),removeEventListener(){},play:()=>Promise.resolve()});
  const pet={assetRoot:'miku',assetBase:'/miku/',pet:{id:'miku'},animations:{idle:[],drag:[]},
    dragState:{},gen:0,front:0,videoA:video(),videoB:video(),reportPlayback(){}};
  const play=name=>r.prototype.switchTo.call(pet,name,true);
  play('first');
  play('second');
  const onError=pet.videoB.onerror;
  handlers[0]();
  assert.equal(pet.videoB.onerror,onError);
  assert.equal(pet.front,0);
  onError();
  handlers[1]();
  assert.equal(pet.front,0);
  play('third');
  handlers[2]();
  assert.equal(pet.front,1);
  pet.animations.idle=['idle'];
  pet.videoB.ended=true;
  const recoveries=[];
  pet.playOnce=name=>{recoveries.push(name);play(name);};
  play('unavailable');
  pet.videoA.onerror();
  assert.deepEqual(recoveries,['idle']);
  handlers[3]();
  assert.equal(pet.front,1);
  pet.videoA.onerror();
  assert.deepEqual(recoveries,['idle']);
});
test('A randomly selected Symphony standing break plays once and always returns to lifted-foot idle',()=>{
  const r=loadRuntime();
  const animations=loadSymphony(root).animations;
  const relax='站久了，放松一下';
  const idle='交响乐待机';
  const pet={pet:{mikuAppearance:'symphony'},assetRoot:'miku',animations,dragState:{},
    anim:idle,facing:'left',stopMove(){},resumeWorkStatusAnim:()=>false,
    playOnce(name){this.anim=name;}};
  Object.assign(r.shared,{rollKind:()=>'action',pickCategoryAction:categories=>{
    const group=categories.find(c=>c.id==='日常');
    assert.ok(group.actions.includes(relax));return {id:group.id,name:relax};
  },isEventAnim:()=>false,pick:pool=>{assert.deepEqual(pool,[idle]);return pool[0];}});
  r.prototype.playIdle.call(pet);
  assert.equal(pet.anim,relax);
  pet.playIdle=()=>assert.fail('The action ended by rolling again before returning to lifted-foot idle');
  r.prototype.handleEnded.call(pet);
  assert.equal(pet.anim,idle);
});
test('An outgoing Miku gesture does not interrupt its already requested successor',()=>{
  const r=loadRuntime();
  const receipts=[];
  const pet={assetRoot:'miku',playback:'old',pending:{anim:'new'},dragState:{},animations:{},
    reportPlayback:(id,status)=>receipts.push([id,status]),playIdle(){assert.fail('replaced pending gesture');}};
  r.prototype.handleEnded.call(pet);
  assert.deepEqual(receipts,[['old','ended']]);
  assert.equal(pet.pending.anim,'new');
});
test('Every active Miku video decodes completely with a visible transparent silhouette',()=>{
  const clips=[...selectActiveClips(collectReadyPreviews(root)),...loadSymphony(root).clips];
  assert.ok(clips.length>0);
  const report=[];
  for(const {target,frames} of clips){
    const file=join(root,'data-dsh/dsh-pet/pet/miku-animation',target+'.webm');
    const args=['-v','error','-c:v','libvpx-vp9','-i',file];
    const decoded=execFileSync(ffmpeg,[...args,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','pipe:1'],{maxBuffer:2*1024*1024});
    assert.equal(decoded.length,640*360*4);
    let opaque=0,transparent=0;
    for(let p=3;p<decoded.length;p+=4){
      if(decoded[p]===0)transparent++;
      if(decoded[p]>240)opaque++;
    }
    assert.ok(transparent>100000&&opaque>5000,target+' visible silhouette');
    const progress=execFileSync(ffmpeg,[...args,'-f','null','-','-progress','pipe:1'],{encoding:'utf8'});
    const decodedFrames=[...progress.matchAll(/^frame=(\d+)/gm)].at(-1);
    assert.equal(Number(decodedFrames?.[1]),frames,target+' complete decoding');
    report.push({name:target,frames,opaque,transparent});
  }
  writeFileSync(join(root,'docs/dsh视频素材检查.json'),JSON.stringify(report,null,2)+'\n');
});
