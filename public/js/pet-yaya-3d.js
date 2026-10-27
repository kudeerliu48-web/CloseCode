/* 独立3D芽芽：精灵和叠加层共享单帧坐标，不影响2D播放器。 */
(function(root){
  'use strict';
  const SLEEP_AFTER=180000, IDLE_MODES=['idle','snack','walk','tantrum','proud','swing'];
  // Derived from bean_body projected vertices across all 16 frames, NOT the
  // sprite bbox (which includes props/shadows). Undo Scene.root's model scale.
  // A common .66 leaves the complete swing/shadow inside the fixed stage.
  const BODY_SCALE=.66;
  function spriteLayout(mode){
    const modelScale=mode==='tantrum'?.66:mode==='swing'?.72:1;
    const scale=BODY_SCALE/modelScale;
    const x=mode==='tantrum'?128-135*scale:128-128*scale;
    const y=mode==='tantrum'?10:mode==='swing'?40:92;
    // Stable whole-cycle top envelopes; do not chase the bob/roll each frame.
    // Swing anchors to the sprout envelope (62), not the crossbar (18).
    const headTop=mode==='sleep'?115:mode==='tantrum'?149:mode==='swing'?62:31;
    const bodyWidth=(mode==='sleep'?139.7:mode==='tantrum'?93.2:mode==='swing'?84.781:117.752)*scale;
    const bodyCenter=x+(mode==='sleep'?122.397:128)*scale;
    return {scale,x,y,bodyWidth,bodyCenter,speechTip:y+headTop*scale-4};
  }
  function petYaya3DMarkup(){return `<canvas id="yaya3d" class="actor" width="320" height="368" role="img" aria-label="芽芽小机灵·3D"></canvas><style>
#yaya3d.actor{display:none;width:160px!important;height:184px!important;left:0;top:0;animation:none!important;transform:none!important;filter:none!important;touch-action:none}
.c-yaya3d #yaya3d.actor{display:block}.c-yaya3d #stage{width:160px!important;min-width:160px!important;max-width:160px!important;height:184px!important;min-height:184px!important;flex:0 0 184px!important;overflow:hidden}
.c-yaya3d #cat,.c-yaya3d #photo,.c-yaya3d #fx,.c-yaya3d #halo,.c-yaya3d #shadow,.c-yaya3d #drop,.c-yaya3d #bubble,.c-yaya3d #stage>.actor:not(#yaya3d){display:none!important}
</style>`;}
  function createPetYaya3D(canvas,options={}){
    const now=options.now||(()=>performance.now()), later=options.later||root.setTimeout.bind(root), cancel=options.cancel||root.clearTimeout.bind(root);
    const media=options.media||root.matchMedia('(prefers-reduced-motion: reduce)'), doc=canvas.ownerDocument;
    const c=canvas.getContext('2d'), writer=root.createPetTypewriter({now,interval:130});
    canvas.width=320;canvas.height=368;
    let active=false,state='idle',tokens=null,enteredAt=now(),idleAt=null,hovered=false,hoverAt=0,disposed=false,timer=null;
    let manifest=null,error='',manifestRequest=null,renderedFrame=0;
    let notifiedMode='',voiceText='',sleepAt=null,dreamAt=null,windowHidden=false;
    function notifyMode(mode){if(mode===notifiedMode)return;notifiedMode=mode;sleepAt=mode==='sleep'?now():null;dreamAt=sleepAt===null?null:sleepAt+30000;if(typeof options.onMode==='function')options.onMode(mode,{text:voiceText});}
    function voiceHint(kind){if(typeof options.onVoice==='function')options.onVoice(kind);}
    // Read once per rendered frame, never fall back to the transparent stage box.
    // Atlas soft shadows peak well below 128; solid body/props/speech stay clickable.
    const HIT_ALPHA=128;
    let hitPixels=null,hitRead=false,drawing=false;
    function hit(x,y){
      if(!active||disposed||!Number.isFinite(x)||!Number.isFinite(y))return false;
      const r=canvas.getBoundingClientRect();
      if(!(r.width>0&&r.height>0)||x<r.left||y<r.top||x>=r.right||y>=r.bottom)return false;
      if(!hitRead){hitRead=true;try{hitPixels=c.getImageData(0,0,canvas.width,canvas.height).data;}catch(_){hitPixels=null;}}
      if(!hitPixels)return false;
      const px=Math.floor((x-r.left)*canvas.width/r.width),py=Math.floor((y-r.top)*canvas.height/r.height);
      return hitPixels[(py*canvas.width+px)*4+3]>=HIT_ALPHA;
    }
    const images={},assets={},base=options.base||'assets/pet-yaya-3d/';
    const random=options.random||Math.random;
    let dreamSeeds=[],dreamDrops=[];
    function resetDream(){dreamSeeds=[];dreamDrops=[];}
    function dreamSample(slot,cycle){
      if(!dreamSeeds[slot]||dreamSeeds[slot].cycle!==cycle){
        const unit=()=>Math.max(0,Math.min(.999999,Number(random())||0));
        dreamSeeds[slot]={cycle,amount:1+Math.floor(unit()*99),offset:(unit()-.5)*24};
      }
      return dreamSeeds[slot];
    }
    function drawDream(s){
      const overlay=manifest.overlays.sleep,[dx,dy]=overlay.dreamAnchor,[zx,zy]=overlay.zzzAnchor;
      const elapsed=Math.max(0,now()-(s.state==='idle'?idleAt+SLEEP_AFTER:enteredAt));
      dreamDrops=[];
      for(let i=0;i<(s.reduced?1:3);i++){
        const age=elapsed-i*1200;
        if(!s.reduced&&age<0)continue;
        const cycle=s.reduced?0:Math.floor(age/3600),progress=s.reduced?0:(age%3600)/2600;
        if(progress>=1)continue; // Disappear at the body; wait before the next fall.
        const seed=dreamSample(i,cycle),startX=dx+(i-1)*66+seed.offset;
        const x=s.reduced?dx:startX+(dx+(i-1)*12-startX)*progress;
        const y=s.reduced?dy-28:8+(210-8)*progress;
        const alpha=s.reduced?.8:Math.min(1,(1-progress)/.24);
        dreamDrops.push({text:'token +'+seed.amount,x,y,alpha,progress});
        c.save();c.globalAlpha=alpha;
        c.shadowColor='#fff2b8';c.shadowBlur=4;
        text('token +'+seed.amount,x,y,18,'#946020');c.restore();
      }
      c.save();c.globalAlpha=s.reduced?.7:.1+.9*(1+Math.sin(now()/650))/2;text('zzz',zx,zy,19);c.restore();
    }
    function snapshot(){
      const t=now(),idleAge=idleAt===null?0:Math.max(0,t-idleAt);
      const mode=state==='idle'?(idleAge>=SLEEP_AFTER?'sleep':IDLE_MODES[Math.floor(idleAge/12000)%IDLE_MODES.length]):state;
      const phrase={idle:'才没有等你呢，哼～',snack:'烤串不给你，给你一小口～',walk:'散个步也要跟着我呀～',tantrum:'哼！哄一下就好啦',proud:'再看就要夸我可爱啦',swing:'推高一点点，就一点点～',done:'做完啦，快夸夸我～',sleep:'好多token，发财了',asking:'芽芽等你回应',error:'芽芽遇到问题'};
      const message=state==='working'?(hovered?['再催就双倍token','芽芽在干活、别催'][Math.floor((t-hoverAt)/4000)%2]:'努力干活中'):(mode==='sleep'||state==='done'||hovered||state==='asking'||state==='error'?phrase[mode]||phrase.idle:'');
      return {active:active&&!disposed,state,mode,tokens,tokenText:tokens===null?'—':String(tokens),idleAt,idleAge,enteredAt,hovered,message,sleeping:mode==='sleep',reduced:!!media.matches,frame:renderedFrame,timer,assets:{...assets},dreamDrops:dreamDrops.map(drop=>({...drop})),error,disposed};
    }
    function text(value,x,y,size=16,color='#594374',maxWidth){c.font=`bold ${size}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillStyle=color;c.fillText(value,x,y,maxWidth);}
    function speech(value,tip=100,full=value,sleeping=false,layout=spriteLayout('idle')){
      // Keep the balloon solid while its first character is pending; otherwise
      // entering it resets typing, removes the hit pixels, and flickers hover.
      if(!full)return;
      // 12 logical px = 7.5 CSS px; wrap the full phrase before typing starts.
      c.save();c.font='700 12px "Microsoft YaHei",sans-serif';
      const w=layout.bodyWidth,x=layout.bodyCenter-w/2,lineHeight=14;
      function wrap(input){
        const lines=[''];
        for(const word of input.match(/[A-Za-z0-9]+|[^A-Za-z0-9]/gu)||[]){
          let i=lines.length-1;
          if(lines[i]&&((sleeping&&lines[i].endsWith('，'))||c.measureText(lines[i]+word).width>w-12)){lines.push('');i++;}
          lines[i]+=word;
        }
        return lines;
      }
      // Reveal characters on the final line layout so partial English words never jump rows.
      const fullLines=wrap(full);let remaining=Array.from(value).length;
      const lines=fullLines.map(line=>{const chars=Array.from(line),visible=chars.slice(0,Math.max(0,remaining)).join('');remaining-=chars.length;return visible;});
      const count=fullLines.length,height=Math.max(24,count*lineHeight+8);
      const y=Math.max(8,tip-height-8);
      c.shadowColor='#65538c25';c.shadowBlur=6.4;c.shadowOffsetY=3.2;
      c.fillStyle=sleeping?'#fff7e7':'#fff2fa';c.beginPath();c.roundRect(x,y,w,height,19.2);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;
      c.strokeStyle='#b7a4d4';c.lineWidth=2.08;c.stroke();
      c.beginPath();c.moveTo(x+w*.42,y+height-1.6);c.quadraticCurveTo(x+w*.43,y+height+16,x+w*.53,y+height+8);c.lineTo(x+w*.58,y+height-1.6);c.fill();
      // A tiny sprout on the upper rim, outside the reserved text area.
      c.strokeStyle='#62a87c';c.lineWidth=1.6;c.beginPath();c.moveTo(x+18,y+5);c.lineTo(x+18,y-3);c.stroke();
      c.fillStyle='#8bd6a4';c.beginPath();c.ellipse(x+14,y-2,5,2.6,.55,0,Math.PI*2);c.fill();
      c.fillStyle='#65bd91';c.beginPath();c.ellipse(x+22,y-4,5,2.8,-.55,0,Math.PI*2);c.fill();
      const firstLineY=y+height/2-(count-1)*lineHeight/2;
      lines.forEach((line,i)=>{c.fillStyle='#423365';c.textAlign='center';c.textBaseline='middle';c.fillText(line,layout.bodyCenter,firstLineY+i*lineHeight);});c.restore();
    }
    function fps(){return state==='working'?18:(manifest?manifest.fps:12);}
    function wake(){if(disposed||!active||!snapshot().sleeping)return false;notifyMode('wake');state='idle';enteredAt=idleAt=now();hovered=false;resetDream();writer.reset();redraw();return true;}
    function draw(){
      if(disposed||drawing)return;
      drawing=true;
      try{paintFrame();}
      finally{
        hitPixels=null;hitRead=false;
        // Re-evaluate a stationary pointer against this frame. Hover changes in
        // this callback apply next frame, not a recursive redraw/feedback loop.
        try{if(typeof options.onFrame==='function')options.onFrame();}finally{drawing=false;}
      }
    }
    function paintFrame(){
      c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,320,368);
      const s=snapshot();notifyMode(s.active?s.mode:'inactive');if(!s.active){writer.reset();return;}
      if(s.sleeping&&dreamAt!==null&&now()>=dreamAt){dreamAt=sleepAt+(Math.floor((now()-sleepAt)/30000)+1)*30000;voiceHint('dream');}
      // 单帧256×288等比放入160×184舞台；后续所有文字沿用相同变换。
      const w=manifest?manifest.width:256,h=manifest?manifest.height:288,scale=Math.min(320/w,368/h);
      c.setTransform(scale,0,0,scale,(320-w*scale)/2,(368-h*scale)/2);
      if(error){speech('3D芽芽加载失败，请重新打开',145);return;}
      if(!manifest){speech('3D芽芽准备中…',145);return;}
      const mode=manifest.aliases[s.mode]||s.mode, key=manifest.states[mode]?mode:'idle',entry=manifest.states[key];
      if(assets[key]!=='ready'){speech(assets[key]==='error'?'3D动作加载失败，请重新打开':'3D芽芽准备中…',145);return;}
      // Sprite and manifest overlays MUST share this exact transform.
      const layout=spriteLayout(key);
      c.save();c.translate(layout.x,layout.y);c.scale(layout.scale,layout.scale);
      renderedFrame=s.reduced?0:Math.floor(Math.max(0,now()-enteredAt)*fps()/1000)%entry.frames;
      c.drawImage(images[key],(renderedFrame%entry.columns)*w,Math.floor(renderedFrame/entry.columns)*h,w,h,0,0,w,h);
      if(s.state==='done'){
        const overlay=manifest.overlays.done,r=overlay.safeRect,label=s.tokenText;
        c.save();c.beginPath();c.rect(r.x,r.y,r.width,r.height);c.clip();
        const lineHeight=r.height/2;
        text('本次 TOKEN',r.x+r.width/2,r.y+lineHeight/2,Math.min(14,lineHeight-2),overlay.color,r.width-2);
        let size=Math.min(14,lineHeight-2);c.font=`bold ${size}px sans-serif`;
        const measured=c.measureText(label).width;if(measured>r.width-2)size*=((r.width-2)/measured);
        text(label,r.x+r.width/2,r.y+lineHeight*1.5,size,overlay.color,r.width-2);c.restore();
      }
      if(s.sleeping)drawDream(s);
      else resetDream();
      c.restore();
      const cycle=state==='working'?Math.floor(Math.max(0,now()-(hovered?hoverAt:enteredAt))/(hovered?4000:3000)):0;
      const typed=writer.sample(s.message,{key:s.mode+':'+hovered+':'+cycle,visible:!!s.message,reduced:s.reduced}).text;
      // Reserve the full phrase height from its first character: no typing jitter.
      // At 100% zoom, one logical pixel is scale/2 CSS pixels. Move only
      // the sleep bubble 50 CSS px closer to the body, independent of typing.
      const sleepTip=72+50*2/scale;
      speech(typed,s.sleeping?sleepTip:layout.speechTip,s.message,s.sleeping,layout);
      canvas.setAttribute('aria-label','芽芽小机灵·3D '+s.mode+(s.state==='done'?' TOKEN '+s.tokenText:''));
    }
    function stop(){if(timer!==null)cancel(timer);timer=null;}
    function hidden(){return windowHidden||doc&&doc.hidden;}
    function visibility(){if(dreamAt!==null)dreamAt=sleepAt+(Math.floor((now()-sleepAt)/30000)+1)*30000;redraw();}
    function schedule(){if(!disposed&&active&&!hidden()&&timer===null)timer=later(()=>{timer=null;draw();schedule();},media.matches?500:1000/fps());}
    function redraw(){if(drawing)return;stop();if(!hidden())draw();schedule();}
    function hover(on){if(disposed)return;on=!!on&&active;if(on===hovered)return;hovered=on;if(on){hoverAt=now();if(['working','tantrum','proud'].includes(snapshot().mode))voiceHint('hint');if(state==='working'&&typeof options.onWorkingHint==='function')options.onWorkingHint();}redraw();}
    // Hover is owned by pet.html's alpha-aware pointer tracking, not stage enter.

    if(doc)doc.addEventListener('visibilitychange',visibility);
    if(media.addEventListener)media.addEventListener('change',redraw);else if(media.addListener)media.addListener(redraw);
    function loaded(data){
      if(disposed)return;
      try{
        if(!(data.width>0&&data.height>0&&data.fps>0))throw Error('帧尺寸或帧率无效');
        for(const key of ['working','done','sleep',...IDLE_MODES]){const e=data.states[key];if(!e||!e.file||!(e.frames>0&&e.columns>0))throw Error('缺少动作 '+key);}
        if(!data.overlays.done.safeRect||!data.overlays.sleep.zzzAnchor||!data.overlays.sleep.dreamAnchor)throw Error('缺少叠加坐标');
        manifest={...data,aliases:data.aliases||{}};
        Object.entries(data.states).forEach(([key,e])=>{
          const image=new root.Image();images[key]=image;assets[key]='loading';
          image.onload=()=>{if(disposed)return;assets[key]=image.naturalWidth>=data.width*e.columns&&image.naturalHeight>=data.height*Math.ceil(e.frames/e.columns)?'ready':'error';redraw();};
          image.onerror=()=>{if(disposed)return;assets[key]='error';redraw();};image.src=base+e.file;
        });
      }catch(e){error='素材清单无效：'+e.message;}redraw();
    }
    function failed(){if(disposed)return;error='无法读取3D素材清单';redraw();}
    if(options.manifest)loaded(options.manifest);
    else{
      // Electron loadFile使用file协议，XMLHttpRequest兼容离线清单读取。
      manifestRequest=new root.XMLHttpRequest();manifestRequest.open('GET',base+'manifest.json');manifestRequest.timeout=15000;
      manifestRequest.onload=()=>{try{if(manifestRequest.status!==0&&(manifestRequest.status<200||manifestRequest.status>=300))return failed();loaded(JSON.parse(manifestRequest.responseText));}catch(_){failed();}};
      manifestRequest.onerror=failed;manifestRequest.ontimeout=failed;manifestRequest.send();
    }
    function dispose(){if(disposed)return;disposed=true;active=false;stop();resetDream();writer.reset();if(manifestRequest)manifestRequest.abort();
      hitPixels=null;hitRead=false;if(doc)doc.removeEventListener('visibilitychange',visibility);
      if(media.removeEventListener)media.removeEventListener('change',redraw);else if(media.removeListener)media.removeListener(redraw);
      Object.values(images).forEach(image=>{image.onload=null;image.onerror=null;});c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,320,368);
    }
    return {setState(character,input,meta={}){if(disposed)return;const data=input&&typeof input==='object'?input:meta,next=typeof input==='string'?input:data.state||data.status||'idle',on=character==='yaya3d';
      const wasHidden=windowHidden;windowHidden=data.hidden===true;
      if(wasHidden!==windowHidden&&dreamAt!==null)dreamAt=sleepAt+(Math.floor((now()-sleepAt)/30000)+1)*30000;
      if(on!==active||next!==state){enteredAt=now();idleAt=on&&next==='idle'?enteredAt:null;hovered=false;resetDream();writer.reset();}
      if(next==='error'&&voiceText!==String(data.text||''))notifiedMode='';
      voiceText=String(data.text||'');active=on;state=next;tokens=Number.isSafeInteger(data.tokens)&&data.tokens>=0?data.tokens:null;redraw();},hover,wake,
      hit,snapshot,dispose,destroy:dispose};
  }
  root.petYaya3DMarkup=petYaya3DMarkup;root.createPetYaya3D=createPetYaya3D;
  if(typeof module==='object'&&module.exports)module.exports={petYaya3DMarkup,createPetYaya3D,SLEEP_AFTER};
})(typeof window!=='undefined'?window:globalThis);
