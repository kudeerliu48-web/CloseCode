/* Local, opt-in voice playback. Never synthesizes or requests remote audio. */
(function(root){
  'use strict';
  const localFiles=new Set(['荡秋千','token不足','做完了','做梦','干活','我要验牌','擦皮鞋','烤串','牛逼','生气傲娇','睡觉','遇到问题','醒了','闪亮登场','马上就好'].map(name=>'../mp3/'+name+'.mp3'));
  function classifyPetVoiceError(state,text){
    if(state!=='error')return state;
    return /insufficient[_\s-]*(quota|balance|credits)|(?:quota|balance|credits)[_\s-]*(exhausted|depleted)|(?:余额|额度|积分|点数)(?:已)?(?:不足|耗尽|用尽)|(?:token|tokens)(?:余额|额度)(?:不足|耗尽)/i.test(String(text||''))?'quota_error':'error';
  }
  function safeVoiceFile(file){return typeof file==='string'&&(localFiles.has(file)||/^[-a-z0-9_]+\.(mp3|wav|ogg)$/i.test(file));}
  function createPetYayaVoice(options={}){
    const now=options.now||Date.now, AudioClass=options.Audio||root.Audio;
    const base=options.base||'assets/pet-yaya-voice/';
    let entries={},enabled=false,volume=.7,active=false,hidden=false,windowHidden=false,disposed=false;
    let current=null,lastState='',request=null;
    const played=new Map(),failed=new Set();
    let ready=false,entryPending=false,entered=false,pending=null,pendingHint=null,currentState='',blocked=false;
    const valid=()=>enabled&&active&&!hidden&&volume>0&&!disposed;
    function flush(){
      if(!ready||!valid()||current||blocked)return;
      if(entryPending){entryPending=false;entered=true;void play('entrance').then(flush);return;}
      const next=pending||pendingHint;
      if(!next)return;
      if(pending)pending=null;else pendingHint=null;
      void play(next).then(flush);
    }
    function unlock(){if(blocked){blocked=false;flush();}}
    const important=new Set(['working','done','asking','error','quota_error','wake']);
    let mainState='',sleepAt=null,dreamSlot=0;
    function stop(){if(current){current.onended=current.onerror=null;current.pause();current.removeAttribute('src');current.load();current=null;}currentState='';}
    function configure(config={}){
      const wasActive=active,wasHidden=hidden;
      enabled=config.voice_enabled===true;active=config.character==='yaya3d';
      if(Number.isFinite(config.voice_volume))volume=Math.max(0,Math.min(1,config.voice_volume));
      windowHidden=config.hidden===true;hidden=windowHidden||!!root.document?.hidden;
      if(wasHidden&&!hidden&&sleepAt!==null)dreamSlot=Math.floor((now()-sleepAt)/30000);
      // Settings previews do not announce an entrance; only the actual pet opts in.
      if(config.announceEntrance===true&&!entered&&valid()&&!lastState)entryPending=true;
      if(wasActive!==active){lastState='';mainState='';pending=pendingHint=null;stop();}
      if(typeof config.state==='string'){
        const next=active?classifyPetVoiceError(config.state,config.text):'inactive';
        if(next!==mainState){mainState=next;event(next);}
      }
      if(!valid()){pending=pendingHint=null;entryPending=false;stop();}
      else{
        // Visibility/setting recovery must never replay an expired scene.
        if(current)current.volume=volume;
        // Let this same push's onMode update an idle subscene before draining.
        Promise.resolve().then(flush);
      }
    }
    function load(data){entries=data&&data.states||{};ready=true;flush();}
    async function play(state,preview=false){
      if(disposed||!active||hidden||(!preview&&!enabled)||volume===0)return {ok:false,reason:'disabled'};
      if(!ready)return {ok:false,reason:'loading'};
      const entry=entries[state];
      if(!entry||entry.available!==true||!safeVoiceFile(entry.file)||failed.has(entry.file))return {ok:false,reason:'missing'};
      const t=now(),cooldown=state==='dream'?0:state.endsWith('_hint')?30000:important.has(state)||state==='sleep'?0:15000;
      if(!preview&&played.has(entry.file)&&t-played.get(entry.file)<cooldown)return {ok:false,reason:'cooldown'};
      if(current&&!preview)return {ok:false,reason:'busy'};
      stop();
      let audio;
      try{
        audio=new AudioClass(base+entry.file);current=audio;currentState=state;audio.volume=volume;audio.loop=false;
        audio.onended=()=>{if(current===audio){stop();flush();}};
        audio.onerror=()=>{if(current===audio){failed.add(entry.file);stop();flush();}};
        await audio.play();
        if(current===audio){played.set(entry.file,t);if(state==='entrance')options.onEntrance?.();}
        return current===audio?{ok:true}:{ok:false,reason:failed.has(entry.file)?'missing':'cancelled'};
      }catch(e){
        if(current!==audio)return {ok:false,reason:'cancelled'};
        // Retry only on a real gesture, never on animation frames or a timer.
        if(e&&e.name==='NotAllowedError'){
          blocked=true;
          if(state==='entrance'){entryPending=true;entered=false;}
          else if(state===lastState)pending=state;
        }else failed.add(entry.file);
        if(current===audio)stop();
        return {ok:false,reason:e&&e.name==='NotAllowedError'?'blocked':'missing'};
      }
    }
    function event(state,meta={}){
      state=classifyPetVoiceError(state,meta.text);
      if(state===lastState)return;
      lastState=state;pendingHint=null;pending=null;
      sleepAt=state==='sleep'?now():null;dreamSlot=0;
      if(state==='inactive'){entryPending=false;stop();return;}
      if(state==='sleep'||blocked&&entryPending){entryPending=false;entered=true;stop();}
      if(!valid())return;
      pending=state;
      // Only the current scene may survive; wake speech spans its immediate idle redraw.
      if(current&&currentState!=='entrance'&&!(currentState==='wake'&&state==='idle'))stop();
      flush();
    }
    function extra(state){
      if(!state||!valid())return Promise.resolve({ok:false,reason:'inactive'});
      if(current||!ready||entryPending||blocked){pendingHint=state;return Promise.resolve({ok:false,reason:'queued'});}
      return play(state);
    }
    function hint(){return extra({working:'working_hint',tantrum:'tantrum_hint',proud:'proud_hint'}[lastState]);}
    function dream(){
      if(lastState!=='sleep'||sleepAt===null||!valid())return Promise.resolve({ok:false,reason:'inactive'});
      const slot=Math.floor((now()-sleepAt)/30000);
      if(slot<=dreamSlot)return Promise.resolve({ok:false,reason:'cooldown'});
      dreamSlot=slot;
      // A due dream replaces an unplayed sleep entry. Never queue missed intervals.
      pending=null;pendingHint=null;
      if(blocked||!ready)return Promise.resolve({ok:false,reason:blocked?'blocked':'loading'});
      if(current)return Promise.resolve({ok:false,reason:'busy'});
      return play('dream');
    }
    function visibility(){hidden=windowHidden||!!root.document.hidden;if(hidden){pending=pendingHint=null;entryPending=false;stop();}else{if(sleepAt!==null)dreamSlot=Math.floor((now()-sleepAt)/30000);flush();}}
    function dispose(){if(disposed)return;disposed=true;stop();if(request)request.abort();if(root.document){root.document.removeEventListener('visibilitychange',visibility);root.document.removeEventListener('pointerdown',unlock);}root.removeEventListener?.('pagehide',dispose);}
    if(options.manifest)load(options.manifest);
    else if(root.XMLHttpRequest){
      request=new root.XMLHttpRequest();request.open('GET',base+'manifest.json');request.timeout=5000;
      request.onload=()=>{if(disposed)return;try{if(request.status===0||request.status===200)load(JSON.parse(request.responseText));}catch(_){}};
      request.onerror=request.ontimeout=()=>{};request.send();
    }
    if(root.document){root.document.addEventListener('visibilitychange',visibility);root.document.addEventListener('pointerdown',unlock);}
    root.addEventListener?.('pagehide',dispose);
    return {configure,event,hint,dream,preview:(state='working')=>play(state,true),stop,dispose};
  }
  root.createPetYayaVoice=createPetYayaVoice;
  if(typeof module==='object'&&module.exports)module.exports={createPetYayaVoice,safeVoiceFile,classifyPetVoiceError};
})(typeof window!=='undefined'?window:globalThis);
