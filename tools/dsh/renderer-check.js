// Runs inside the application's isolated desktop test window.
async function checkMikuPlayback(activeClips=[]) {
  const pet=sprites[0], result={clips:[],actionCycles:[],sleepCycle:false,idleCycle:false,noMirror:false,heldDragLoops:false};
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async(fn,label,timeout=4000)=>{
    const end=performance.now()+timeout;
    while(performance.now()<end){if(fn())return;await delay(40);}
    throw new Error('Miku video check timed out: '+label);
  };
  const front=()=>pet.front===0?pet.videoA:pet.videoB;
  const showing=name=>!pet.pending&&front().readyState>=2&&decodeURIComponent(front().src).endsWith('/'+name+'.webm');
  const play=async name=>{
    pet.playOnce(name);
    await until(()=>showing(name),name);
    await delay(90);
  };
  const pointer=(type,pointerId,x,y)=>{
    const released=type==='pointerup';
    (released?window:pet.hit).dispatchEvent(new PointerEvent(type,{
      bubbles:true, pointerId, button:0, buttons:released?0:1,
      clientX:x, clientY:y, screenX:x, screenY:y,
    }));
  };
  const beginDrag=(pointerId)=>{
    pet.lastPressAt=-Infinity;
    pointer('pointerdown',pointerId,1000,600);
    pointer('pointermove',pointerId,940,624);
  };
  const stage=pet.el.querySelector('.pet-stage');
  result.fade={isolation:getComputedStyle(stage).isolation,blendA:getComputedStyle(pet.videoA).mixBlendMode,blendB:getComputedStyle(pet.videoB).mixBlendMode};
  const names=new Set(['待机眨眼','挥挥手','开心回应','打个盹','慢慢醒来','害羞一下','打个招呼','散步一下','提起晃腿','落地站稳','左右张望','整理帽子','撑伞致意','轻快舞步','开心摇摆','睡梦中','悬空轻晃',...activeClips.map(clip=>clip.target)]);
  for(const name of names){
    await play(name);
    const video=front();
    result.clips.push({name,width:video.videoWidth,height:video.videoHeight,playing:!video.paused,time:video.currentTime,error:video.error?.code??null});
  }
  const idle=pet.animations.idle[0], random=Math.random;
  // Real mouse input can reach the transparent test window while it is visible.
  const inputTypes=['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','mousemove','click','contextmenu','keydown','blur'];
  const ignorePhysicalInput=event=>{if(event.isTrusted)event.stopImmediatePropagation();};
  for(const type of inputTypes)window.addEventListener(type,ignorePhysicalInput,true);
  try{
    Math.random=()=>0;
    await play(idle);
    const firstPass=front();
    await until(()=>showing(idle)&&front()!==firstPass&&front().currentTime>.2,'repeat idle',12000);
    result.idleCycle=true;

    result.whisperLines=[];
    for(let i=0;i<2;i++){
      if(!await pet.onMenuAction({action:'miku-whisper'}))throw new Error('Miku whisper did not display');
      const text=pet.whisperView?.[0]?.text;
      if(!pet.whisperOn||!text||!pet.bubble.textContent.includes(text))throw new Error('Miku whisper bubble was not rendered');
      result.whisperLines.push(text);
      pet.clearWhisper();
      await until(()=>showing(idle),'whisper returns to idle',9000);
    }

    result.quotaTiers=[];
    for(const [remaining,tier] of [[70,'full'],[30,'normal'],[10,'low'],[0,'empty']]){
      const windows=[{minutes:300,remaining:80,resetsAt:1800000000},{minutes:10080,remaining,resetsAt:1800000000}];
      const read=()=>Promise.resolve({status:'ok',windows});
      if(!await pet.showMikuCodexQuota(read))throw new Error('Codex quota bubble did not display');
      const quotaClip=activeClips.find(clip=>clip.quotaTier===tier);
      if(quotaClip){
        await until(()=>showing(quotaClip.target)&&front().currentTime>.2,'quota video '+tier);
        if(stage.querySelector('.miku-quota-prop'))throw new Error('Quota video has an extra prop overlay');
        if(Math.abs(front().duration-quotaClip.frames/24)>.06)throw new Error('Wrong quota video duration');
      }else{
        await until(()=>stage.querySelector('.miku-quota-prop')?.dataset.tier===tier,'quota prop '+tier);
      }
      if(!pet.bubble.classList.contains('is-miku-quota') || !pet.bubble.textContent.includes('7 天 剩 '+remaining+'%'))
        throw new Error('Codex quota text missing for '+tier);
      if(remaining===0 && !pet.bubble.textContent.includes('7 天额度已用完'))
        throw new Error('Codex quota did not identify the exhausted window');
      await until(()=>showing(idle)&&!stage.querySelector('.miku-quota-prop'),tier+' quota returns to idle',9000);
      pet.clearWhisper();
      result.quotaTiers.push(tier);
    }

    for(const {target} of activeClips){
      if([idle,'打个盹','睡梦中','慢慢醒来'].includes(target))continue;
      const walking=target==='散步一下';
      const stepping=target==='原地踏步';
      if(walking)pet.facing='left';
      const {x:startX,y:startY}=pet.pos;
      pet.onMenuAction({label:target,anim:target});
      await until(()=>showing(target),target);
      const video=front();
      await until(()=>video.currentTime>.2,target+' playback');
      if(walking)await until(()=>startX-pet.pos.x>3&&showing(target),'walk moves the window',7000);
      await until(()=>{
        if(stepping&&(pet.pos.x!==startX||pet.pos.y!==startY))throw new Error('Marching in place moved the window');
        return showing(idle);
      },target+' returns to idle',15000);
      result.actionCycles.push({name:target,returnedToIdle:true,...(walking?{movedWindow:true}:stepping?{stayedInPlace:true}:{})});
    }

    result.clickCycles=[];
    for(const name of ['害羞一下',...activeClips.filter(clip=>clip.clickAction).map(clip=>clip.target)]){
      const index=pet.animations.clicks.indexOf(name);
      if(index===-1)throw new Error('Missing click reaction: '+name);
      Math.random=()=>(index+.5)/pet.animations.clicks.length;
      pet.hit.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      Math.random=()=>0;
      await until(()=>showing(name),'click triggers '+name);
      await until(()=>showing(idle),name+' click returns to idle',12000);
      result.clickCycles.push({name,returnedToIdle:true});
    }
    result.shyClick=result.clickCycles.some(cycle=>cycle.name==='害羞一下');

    pet.facing='right';await play('挥挥手');
    result.noMirror=!front().style.transform.includes('scaleX');
    await play(idle);
    beginDrag(81);
    await until(()=>showing('提起晃腿')&&!front().loop,'pick up plays once');
    await until(()=>showing('悬空轻晃')&&front().loop,'held drag loops',6500);
    const suspended=front();
    await until(()=>suspended.currentTime>suspended.duration-.35,'suspended loop reaches the end',10000);
    await until(()=>showing('悬空轻晃')&&front()===suspended&&suspended.currentTime<.5,'suspended loop repeats');
    result.heldDragLoops=true;
    pointer('pointerup',81,940,624);
    await until(()=>showing('落地站稳')&&!front().loop,'gentle release plays landing');
    await until(()=>showing(idle),'gentle release returns to idle',6500);
    result.gentleDragCycle=true;

    beginDrag(82);
    pointer('pointerup',82,940,624);
    await until(()=>showing('落地站稳'),'quick release replaces pending pickup');
    await until(()=>showing(idle),'quick release returns to idle',6500);
    result.quickDragCycle=true;

    beginDrag(83);
    await delay(45);
    pointer('pointermove',83,870,630);
    pointer('pointerup',83,870,630);
    await until(()=>pet.throwState&&showing('悬空轻晃')&&front().loop,'fling holds suspended pose');
    await until(()=>!pet.throwState&&showing('落地站稳'),'fling settles before landing',18000);
    await until(()=>showing(idle),'fling returns to idle',6500);
    result.flingCycle=true;
    pet.goHome();

    pet.onMenuAction({label:'睡觉',action:'sleep'});
    await until(()=>pet.sleepPhase==='start'&&showing('打个盹'),'sleep entry');
    await until(()=>pet.sleepPhase==='loop'&&showing('睡梦中')&&front().loop,'sleep loop',6500);
    const dream=front();
    await until(()=>dream.currentTime>dream.duration-.35,'sleep loop reaches the end',12000);
    await until(()=>showing('睡梦中')&&front()===dream&&dream.currentTime<.5,'sleep loop repeats');
    result.dreamLoop=true;
    pet.onMenuAction({label:'起来',action:'wake'});
    await until(()=>pet.sleepPhase==='end'&&showing('慢慢醒来'),'wake entry');
    await until(()=>!pet.sleeping&&showing(idle),'wake returns to idle',6500);
    result.sleepCycle=true;
  }finally{
    Math.random=random;
    for(const type of inputTypes)window.removeEventListener(type,ignorePhysicalInput,true);
  }
  pet.facing='left';await play(idle);
  result.passed=result.fade.isolation==='isolate'&&result.fade.blendA==='plus-lighter'&&result.fade.blendB==='plus-lighter'
    &&result.clips.every(clip=>clip.width===640&&clip.height===360&&clip.playing&&clip.time>0&&clip.error===null)
    &&result.idleCycle&&result.sleepCycle&&result.dreamLoop&&result.noMirror&&result.heldDragLoops
    &&result.gentleDragCycle&&result.quickDragCycle&&result.flingCycle&&result.shyClick;
  return result;
}
