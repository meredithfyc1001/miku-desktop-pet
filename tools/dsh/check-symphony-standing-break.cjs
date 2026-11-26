'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

function playMenuLeaf(...route) {
  const pet = sprites[0];
  const hit = pet.hit.getBoundingClientRect();
  pet.hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
    button: 2, clientX: hit.x + hit.width / 2, clientY: hit.y + hit.height / 2 }));
  const labels = [...document.querySelectorAll('.dsh-pet-menu-label')];
  if (labels.some(el => ['待机姿势','正面站姿待机'].includes(el.textContent))) throw Error('Retired pose option is still in the menu');
  for(const [i,name] of route.entries()) {
    const matches = labels.filter(el => el.textContent.replace(/^[○●]\s*/, '') === name && el.getClientRects().length);
    if(matches.length !== 1) throw Error('Missing or duplicate menu item: '+name);
    const item = matches[0].parentElement;
    if(i === route.length - 1) item.click();
    else item.dispatchEvent(new MouseEvent('mouseenter'));
  }
  return true;
}

// Send a reproducible roll through the real scheduler. The production category,
// facing rules and action-choice code still run unchanged inside the test window.
function rollStandingBreak(action) {
  const pet=sprites[0], categories=pet.animations.categories.filter(g=>g.actions.length);
  const facingGroups=categories.filter(g=>!(g.noMirror && pet.facing==='right'));
  const groups=facingGroups.length?facingGroups:categories;
  const groupIndex=groups.findIndex(g=>g.id==='日常');
  if(groupIndex<0)throw Error('Daily category is not eligible');
  const group=groups[groupIndex];
  const actions=group.actions.filter(name=>name!==pet.anim);
  const index=actions.indexOf(action);
  if(index<0) throw Error('Expected an eligible daily action');
  const originalRandom=Math.random, weights=pet.weights;
  const weight=list=>list.reduce((sum,entry)=>sum+entry.weight,0);
  const categoryRoll=(weight(groups.slice(0,groupIndex))+group.weight/2)/weight(groups);
  const rolls=[.99,categoryRoll,(index+.5)/actions.length];
  try {
    pet.weights={idle:0,move:0,turn:0};
    Math.random=()=>rolls.length?rolls.shift():originalRandom();
    pet.playIdle();
  } finally { Math.random=originalRandom; pet.weights=weights; }
  return true;
}

async function verifyPlayingFile(js, currentSrc, file, release) {
  const loaded=await js('('+ (async url=>{
    const p=sprites[0], v=p.front?p.videoB:p.videoA;
    if(v.currentSrc!==url) throw Error('Playing media changed');
    const res=await fetch(v.currentSrc,{cache:'no-store'});
    if(res.status!==200) throw Error('Incomplete media response');
    const bytes=await res.arrayBuffer(), hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    return {bytes:bytes.byteLength,sha256:Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase()};
  }).toString()+')('+JSON.stringify(currentSrc)+')');
  assert.equal(loaded.sha256,release.sha256);
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(),release.sha256);
  return loaded;
}

function measureSeams(root, releaseDir, idle, relax) {
  const ff=path.join(root,'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
  const frame=(row,index)=>execFileSync(ff,['-v','error','-c:v','libvpx-vp9','-i',path.resolve(releaseDir,row.file),
    '-vf','select=eq(n\\,'+index+')','-frames:v','1','-f','rawvideo','-pix_fmt','rgba','-']);
  const compare=(a,b)=>{
    assert.equal(a.length,640*360*4);assert.equal(b.length,a.length);
    let bottomA=-1,bottomB=-1,overlap=0,union=0,legOverlap=0,legUnion=0,colorDistance=0;
    for(let y=0;y<360;y++)for(let x=0;x<640;x++){
      const i=(y*640+x)*4, aa=a[i+3], ba=b[i+3], visibleA=aa>=96, visibleB=ba>=96;
      if(!visibleA&&!visibleB)continue;
      if(visibleA)bottomA=y;if(visibleB)bottomB=y;
      union++;if(visibleA&&visibleB)overlap++;
      if(x>=265 && x<375 && y>=222 && y<310){legUnion++;if(visibleA&&visibleB)legOverlap++;}
      for(let c=0;c<3;c++)colorDistance+=Math.abs(a[i+c]*aa-b[i+c]*ba)/255;
    }
    assert.ok(union>0 && legUnion>0);
    return {bottom:[bottomA,bottomB],silhouetteIoU:overlap/union,lowerBodyIoU:legOverlap/legUnion,
      meanPremultipliedColorDifference:colorDistance/(3*union)};
  };
  const start=frame(relax,0), end=frame(relax,relax.frames-1);
  const idleFirst=frame(idle,0), idleLast=frame(idle,idle.frames-1);
  function footContacts(pixels) {
    let sole=-1;
    for(let y=220;y<320;y++)for(let x=265;x<375;x++)if(pixels[(y*640+x)*4+3]>=96){sole=y;break;}
    assert.ok(sole>0);
    const spans=[];
    for(let x=265;x<375;x++){
      let visible=false;
      for(let y=sole-7;y<=sole;y++)if(pixels[(y*640+x)*4+3]>=96){visible=true;break;}
      if(!visible)continue;
      if(spans.length && spans.at(-1)[1]===x-1)spans.at(-1)[1]=x;
      else spans.push([x,x]);
    }
    return {sole,spans:spans.filter(([left,right])=>right-left>=3)};
  }
  const contacts=[0,.25,.5,.75,1].map(fraction=>{
    const index=Math.round(fraction*(relax.frames-1));
    return {frame:index,...footContacts(fraction===0?start:fraction===1?end:frame(relax,index))};
  });
  return {enter:compare(idleLast,start),exit:compare(end,idleFirst),idleLoop:compare(idleLast,idleFirst),contacts};
}

async function checkStandingBreak({js,win,gallery,root,catalog,playing,waitFor,checks,idle,relax}) {
  assert.deepEqual(await js('Array.from(sprites[0].animations.idle)'),[idle]);
  assert.deepEqual(await js('Array.from(sprites[0].pet.mikuFavorites)'),[relax,'提裙致意']);
  assert.deepEqual(catalog.filter(c=>c.name===relax).map(c=>c.category),['日常']);
  assert.ok(!catalog.some(c=>c.name==='正面站姿待机'));
  const releaseDir=path.join(root,'assets/video-production/symphony-2020/v2');
  const manifest=JSON.parse(fs.readFileSync(path.join(releaseDir,'desktop-clips.json'),'utf8'));
  const release=name=>manifest.find(c=>c.name===name);
  const media=name=>path.join(root,'data-dsh/dsh-pet/pet/miku-animation',name+'.webm');
  const active=await playing(idle);
  assert.ok(active.loop);
  checks.push({name:'legacy-front-preference',idle, ...await verifyPlayingFile(js,active.path,media(idle),release(idle))});
  const pick=(...names)=>js('('+playMenuLeaf.toString()+')(...'+JSON.stringify(names)+')');
  for(const trigger of ['context-menu','catalog','random-daily']){
    if(trigger==='context-menu') await pick('动作','日常',relax);
    else if(trigger==='catalog') assert.equal(await gallery.webContents.executeJavaScript('window.mikuActions.play('+JSON.stringify(relax)+')'),'playing');
    else await js('('+rollStandingBreak.toString()+')('+JSON.stringify(relax)+')');
    const start=await waitFor('Standing break did not play via '+trigger,()=>playing(relax));
    assert.equal(start.loop,false);assert.equal(start.width,640);assert.equal(start.height,360);
    assert.ok(Math.abs(start.duration-release(relax).frames/24)<.02);
    const digest=trigger==='context-menu'?await verifyPlayingFile(js,start.path,media(relax),release(relax)):{};
    const returned=await waitFor('Standing break failed to return to lifted-foot idle via '+trigger,()=>playing(idle),(start.duration+10)*1000);
    assert.ok(returned.loop);
    checks.push({name:trigger,duration:start.duration,sequence:[idle,relax,idle],...digest});
  }
  await pick('切换形象','未来有你 2021');
  await waitFor('Classic appearance idle did not start',()=>playing('待机眨眼'));
  await pick('切换形象','交响乐 2020');
  await waitFor('Appearance round trip lost lifted-foot idle',()=>playing(idle));
  const loaded=once(win.webContents,'did-finish-load');
  win.webContents.reload();
  await loaded;
  await waitFor('Renderer reload lost lifted-foot idle',()=>playing(idle).catch(()=>false));
  assert.deepEqual(await js('Array.from(sprites[0].animations.idle)'),[idle]);
  checks.push({name:'appearance-round-trip-and-reload',idle});
  const seams=measureSeams(root,releaseDir,release(idle),release(relax));
  checks.push({name:'seams',...seams});
  // The retired direct cut scored 0.56 for lower-body overlap; ordinary idle breathing
  // scores above 0.92. These tolerances allow imperfect Flow edges and still catch a lost leg pose.
  for(const [edge,value] of [['entry',seams.enter],['return',seams.exit]]) {
    assert.ok(Math.abs(value.bottom[0]-value.bottom[1])<=3,edge+' foot baseline jumps: '+JSON.stringify(value));
    assert.ok(value.silhouetteIoU>=.87 && value.lowerBodyIoU>=.75,edge+' pose does not match idle: '+JSON.stringify(value));
  }
  assert.equal(seams.contacts[0].spans.length,1,'Entry must start on one grounded foot');
  assert.equal(seams.contacts.at(-1).spans.length,1,'Return must finish on one grounded foot');
  assert.ok(seams.contacts.slice(1,-1).some(c=>c.spans.length===2),'No central sample reached a two-foot resting stance');
}
module.exports={checkStandingBreak};
