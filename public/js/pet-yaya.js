/* 芽芽：原画坐标 420 × 410。只管理自己的画布，不修改宿主状态或 body class。 */
(function (root) {
  'use strict';
  const SLEEP_AFTER = 600000;
  function createPetYayaController(options = {}) {
    const now = options.now || (() => performance.now());
    let active = false, state = 'idle', tokens = null, idleAt = null, enteredAt = now();
    let hovered = false, hoverAt = 0, hoverTurn = -1, disposed = false;
    function setState(character, input, meta = {}) {
      if (disposed) return;
      const data = input && typeof input === 'object' ? input : meta;
      const next = typeof input === 'string' ? input : (data.state || data.status || 'idle');
      const on = character === 'yaya', t = now();
      if (on !== active || next !== state) {
        enteredAt = t;
        idleAt = on && next === 'idle' ? t : null;
        hovered = false;
      }
      active = on; state = next;
      tokens = Number.isSafeInteger(data.tokens) && data.tokens >= 0 ? data.tokens : null;
    }
    function snapshot() {
      const t = now(), idleAge = idleAt === null ? 0 : Math.max(0, t - idleAt);
      const sleeping = active && (state === 'sleep' || (state === 'idle' && idleAge >= SLEEP_AFTER));
      const mode = sleeping ? 'sleep' : state === 'idle' ? (Math.floor(idleAge / 12000) % 2 ? 'walk' : 'snack') : state;
      const phrase = (hoverTurn + Math.floor(Math.max(0, t - hoverAt) / 4000)) % 2;
      return { active: active && !disposed, state, mode, tokens, idleAt, idleAge, enteredAt, sleeping,
        hovered, disposed, message: state === 'working' ? (hovered ? ['再催就双倍token', '芽芽在干活、别催'][phrase] : '努力干活中') : '',
        tokenText: tokens === null ? '—' : String(tokens) };
    }
    function wake() {
      if (disposed || !snapshot().sleeping) return false;
      state = 'idle'; enteredAt = idleAt = now(); hovered = false;
      return true;
    }
    return { setState, snapshot, wake, hover(on) { if (disposed) return; if (on && !hovered) { hoverAt = now(); hoverTurn++; } hovered = !!on; },
      dispose() { disposed = true; active = false; hovered = false; idleAt = null; } };
  }
  function petYayaMarkup() {
    return `<canvas id="yaya" class="actor" width="320" height="368" role="img" aria-label="芽芽桌宠"></canvas><style>
#yaya.actor{display:none;width:160px!important;height:184px!important;left:0;top:0;animation:none!important;transform:none!important;filter:none!important;touch-action:none}
.c-yaya #yaya.actor{display:block}.c-yaya #stage{width:160px!important;min-width:160px!important;max-width:160px!important;height:184px!important;min-height:184px!important;flex:0 0 184px!important;overflow:hidden}
.c-yaya #cat,.c-yaya #photo,.c-yaya #fx,.c-yaya #halo,.c-yaya #shadow,.c-yaya #drop,.c-yaya #bubble,.c-yaya #stage>.actor:not(#yaya){display:none!important}
</style>`;
  }
  function createPetYaya(canvas, options = {}) {
    const now = options.now || (() => performance.now());
    const request = options.request || root.requestAnimationFrame.bind(root);
    const cancel = options.cancel || root.cancelAnimationFrame.bind(root);
    const media = options.media || root.matchMedia('(prefers-reduced-motion: reduce)');
    const controller = createPetYayaController({ now });
    const writer = root.createPetTypewriter({ now });
    const c = canvas.getContext('2d');
    if (!c) throw new Error('芽芽需要 Canvas 2D');
    canvas.width = 320; canvas.height = 368;
    let frame = null, disposed = false, lastDraw = -Infinity;
    const assets = {}, assetStatus = {};
    function ellipse(x,y,rx,ry,fill,stroke) {
      c.beginPath(); c.ellipse(x,y,rx,ry,0,0,Math.PI*2); c.fillStyle=fill; c.fill();
      if(stroke){c.strokeStyle=stroke;c.lineWidth=1.2;c.stroke();}
    }
    function line(x,y,x2,y2,color,width=2) { c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.stroke(); }
    function text(value,x,y,size=10,color='#423365') { c.fillStyle=color;c.font=`700 ${size}px "Microsoft YaHei",sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(value,x,y); }
    function panel(x,y,w,h,fill='#fff7df') { c.beginPath();c.roundRect(x,y,w,h,6);c.fillStyle=fill;c.fill();c.strokeStyle='#a59bc6';c.lineWidth=1;c.stroke(); }
    function bubbleBox(x,y,w,h,fill='#fff7fc') {
      c.save();c.shadowColor='#65538c25';c.shadowBlur=4;c.shadowOffsetY=2;
      c.beginPath();c.roundRect(x,y,w,h,12);c.fillStyle=fill;c.fill();c.shadowBlur=0;c.shadowOffsetY=0;
      c.strokeStyle='#b7a4d4';c.lineWidth=1.3;c.stroke();
      c.beginPath();c.moveTo(x+w*.42,y+h-1);c.quadraticCurveTo(x+w*.43,y+h+10,x+w*.53,y+h+5);c.lineTo(x+w*.58,y+h-1);c.fill();
      ellipse(x+10,y+9,3,2,'#ffffff');c.restore();
    }
    function eye(x,y,closed,base) {
      ellipse(x,y,35,37,base);
      if(closed){c.beginPath();c.moveTo(x-23,y);c.quadraticCurveTo(x,y+15,x+23,y);c.strokeStyle='#463667';c.lineWidth=5;c.lineCap='round';c.stroke();}
      else {ellipse(x,y,27,32,'#fff5e9');ellipse(x+2,y+2,21,27,'#30214b');ellipse(x+4,y+11,15,14,'#50317b');ellipse(x+9,y-11,8,9,'#fff');ellipse(x-8,y+10,3,3,'#d9bffa');}
    }
    function grass(t) {
      ellipse(80,167,72,12,'#c7e9bd');
      for(let i=0;i<17;i++){const x=14+i*8,y=165+(i%3)*3;line(x,y,x-2+Math.sin(t/1500+i),y-5,'#79b581',1);}
    }
    function paw(x,y,angle) { c.save();c.translate(x,y);c.rotate(angle);ellipse(0,0,10,6,'#a6a1e3','#7975bb');line(0,-2,2,1,'#8580c1',.7);c.restore(); }
    function draw(t) {
      if (disposed) return;
      const s=controller.snapshot(), reduced=!!media.matches, a=reduced?0:t;
      c.setTransform(2,0,0,2,0,0);c.clearRect(0,0,160,184);
      if(!s.active) { writer.reset(); return; }
      const dream=['好多token，发财了','token雨！接住接住','嘿嘿，满满小金库'][Math.floor(a/4500)%3];
      const speech=s.sleeping?dream:s.state==='working'?s.message:s.state==='asking'?'芽芽等你回应':s.state==='error'?'芽芽遇到问题':'';
      // 工作小牌持续循环：逐字出现后停留，再重新打字；悬停气泡沿用换句动画。
      const typingCycle=s.state==='working'&&!s.hovered&&!reduced?Math.floor(Math.max(0,t-s.enteredAt)/3000):0;
      let typed=writer.sample(speech,{key:s.mode+':'+s.hovered+':'+typingCycle,visible:!!speech,reduced}).text;
      if(s.state==='working'&&!s.hovered&&!reduced){
        // 直接按工作时间驱动可见进度，不依赖某一帧是否碰巧采样到循环起点。
        const phase=Math.max(0,t-s.enteredAt)%3000;
        typed=Array.from(speech).slice(0,Math.min(Array.from(speech).length,Math.floor(phase/240)+1)).join('');
        typed+=phase<1400?'▏':'.'.repeat(1+Math.floor((phase-1400)/400)%3);
      }
      grass(a);
      if(assetStatus.body !== 'ready' || assetStatus.sprout !== 'ready') {
        text(assetStatus.body==='error'||assetStatus.sprout==='error'?'芽芽图层未就绪':'芽芽准备中…',80,100,11); return;
      }
      let x=80,y=109,angle=0,scale=.36;
      if(s.mode==='snack') { x=80;y=118+(reduced?0:Math.sin(a/230)*.6); }
      if(s.mode==='walk') { x=80+(reduced?0:Math.sin(a/2300)*24);y=109+(reduced?0:Math.sin(a/130)*1.5); }
      if(s.sleeping) { x=81;y=136;scale=.29;angle=-1.35; }
      if(s.state==='working') y+=reduced?0:Math.sin(a/100)*.8;
      c.save();c.translate(x,y);c.rotate(angle);c.scale(scale,s.mode==='snack'?scale*.91:scale);c.translate(-190,-230);
      // 手放身后：先绘制轻微露出的手，随后由原画身体覆盖；保留 body 中原有手以保护原画。
      if(s.mode==='walk'){ellipse(70,282,18,22,'#9693d8');ellipse(283,282,18,22,'#9693d8');}
      const explicitLegs=s.mode==='snack'||s.mode==='walk'||s.state==='done';
      if(explicitLegs) {
        const step=s.mode==='walk'&&!reduced?Math.sin(a/150)*7:0;
        // 独立绘制双腿，避免修复身体素材后原画右脚被躯干覆盖。
        ellipse(133,381+step,24,19,'#968bd9','#7768b9');
        ellipse(250,381-step,24,19,'#968bd9','#7768b9');
        c.drawImage(assets.body,0,0,420,369,0,0,420,369);
      } else c.drawImage(assets.body,0,0,420,410);
      c.save();c.translate(190,148);c.rotate(reduced?0:Math.sin(a/650)*.045);c.translate(-190,-148);c.drawImage(assets.sprout,0,0,420,410);c.restore();
      {
        if(assets.arms && assetStatus.arms==='ready' && s.state!=='working' && s.state!=='done' && s.mode!=='walk' && s.mode!=='snack') c.drawImage(assets.arms,0,0,420,410);
        if(s.state==='working'){
          const heat=c.createRadialGradient(184,215,18,184,215,111);
          heat.addColorStop(0,'rgba(255,32,48,'+(reduced?.72:.72+.1*Math.sin(a/900))+')');heat.addColorStop(.72,'rgba(255,53,68,.50)');heat.addColorStop(1,'rgba(255,69,80,0)');
          ellipse(184,218,112,96,heat);ellipse(101,247,20,13,'#ed465e');ellipse(265,257,20,13,'#ed465e');
        }
        const closed=s.sleeping||(!reduced&&a%4200<160);
        eye(142,207,closed,'#b9b2e9');eye(230,225,closed,'#c8afe7');
        text('DoCode',158,s.state==='working'?301:322,26,'#514079');
        if(s.sleeping){
          // 随身体旋转的鼻尖气泡，位置固定在双眼下方，约3秒一呼吸。
          const breath=reduced?.5:(1+Math.sin(a/520))/2;
          const radius=12+breath*17;
          c.save();c.globalAlpha=.68;ellipse(186,261,radius,radius*1.12,'#d7f6ff','#9dbddf');
          c.globalAlpha=.85;ellipse(186-radius*.32,261-radius*.4,radius*.22,radius*.3,'#fff');c.restore();
        }
      }
      c.restore();
      if(s.mode==='walk') {
        const shift=x-80;
        // 背手时仍露出两侧手肘和小手，不让它们被身体完全盖住。
        c.save();c.translate(shift,y-109);
        // 连续弯臂贴着腰侧，掌心转向身体，避免横向椭圆像额外脚掌。
        c.beginPath();c.moveTo(46,126);c.quadraticCurveTo(36,134,44,143);
        c.moveTo(114,126);c.quadraticCurveTo(123,134,115,143);
        c.strokeStyle='#968bd6';c.lineWidth=7;c.lineCap='round';c.stroke();
        c.save();c.translate(44,143);c.scale(.64,.78);paw(0,0,1.15);c.restore();
        c.save();c.translate(115,143);c.scale(.64,.78);paw(0,0,-1.15);c.restore();c.restore();
      }
      if(s.mode==='snack') {
        // 饱满坐姿：双脚向前伸，右手周期性把烤串送到嘴边。
        ellipse(50,163,15,8,'#a69de5','#8274bd');ellipse(107,163,15,8,'#a69de5','#8274bd');
        ellipse(50,162,7,4,'#c7b9f0');ellipse(107,162,7,4,'#c7b9f0');
        const bite=reduced?.5:(1-Math.cos(a/850))/2;
        const sx=123-bite*19,sy=159-bite*8;
        line(112,137,sx,sy,'#9691d6',8);line(45,135,39,147,'#9691d6',8);
        paw(sx,sy,-.5);paw(39,149,.5);
        c.save();c.translate(sx,sy);c.rotate(-.62-bite*.16);
        line(0,5,0,-33,'#ad703c',2.3);
        for(let i=0;i<3;i++){
          const ky=-8-i*9;c.beginPath();c.roundRect(-6,ky-4,12,8,2);c.fillStyle=i===1?'#d58942':'#b95e32';c.fill();
          line(-3,ky-1,3,ky+1,'#753b28',1);ellipse(-2,ky-2,1,.7,'#ffdb82');
        }c.restore();
        if(bite>.72){ellipse(83,124,3.8,2.3,'#703a55');ellipse(90,125,1,1,'#d99446');}
        ellipse(128,166,16,4,'#efe1c5','#bd9d70');line(118,164,140,162,'#ba8551',1.5);
      }
      if(s.state==='working') {
        // 圆角机械小键盘：厚底座、三排独立键帽、空格与彩色回车。
        panel(28,148,105,26,'#8d84b9');panel(28,144,105,25,'#ddd8f5');
        for(let row=0;row<3;row++)for(let col=0;col<10;col++){
          c.beginPath();c.roundRect(34+col*9.2,148+row*5.3,7.2,4.3,1.2);
          c.fillStyle=col===9?'#b4e2d0':row===0&&col===0?'#f5b7ca':'#fff9ed';c.fill();
        }
        c.fillStyle='#b3aad8';c.fillRect(61,164,36,2);ellipse(126,147,1,1,'#78c5a2');
        const tap=reduced?0:Math.sin(a/75)*4;
        line(49,126,57,145+tap,'#9390d2',7);line(111,128,103,145-tap,'#9390d2',7);
        paw(58,145+tap,.12);paw(103,145-tap,-.12);
        // 可读的蓝色汗滴，不复用宿主 drop。
        for(let i=0;i<9;i++) {
          const phase=reduced?.35:((a+i*137)%1200)/1200;
          const sy=70+phase*43+(i%3)*5,sx=i%2?39-(i%3)*4:124+(i%3)*4;
          c.save();c.globalAlpha=.95-phase*.45;
          c.beginPath();c.moveTo(sx,sy-6);c.bezierCurveTo(sx-7,sy+2,sx-4,sy+8,sx,sy+7);c.bezierCurveTo(sx+7,sy+7,sx+4,sy,sx,sy-6);c.fillStyle='#65c5ef';c.fill();
          line(sx-2,sy+1,sx-2,sy+4,'#e4fbff',1.2);c.restore();
        }
        // 红温蒸汽只在两侧，避开豆芽和对话文字。
        for(const [i,sx] of [27,136].entries()){
          const phase=reduced?.4:((a+i*750)%1900)/1900;
          const sway=reduced?0:Math.sin(a/260+i*2)*2.8,lift=reduced?0:phase*9;
          c.save();c.globalAlpha=reduced?.8:.35+.65*Math.sin(Math.PI*phase);
          c.beginPath();c.moveTo(sx,74-lift);c.bezierCurveTo(sx-6+sway,68-lift,sx+6-sway,62-lift,sx+sway,54-lift);
          c.strokeStyle='#eb6d85';c.lineWidth=1.8;c.lineCap='round';c.stroke();c.restore();
        }
        if(s.hovered)bubbleBox(4,3,152,25,'#fff2fa');else panel(12,3,136,24,'#fff7df');
        text(typed,80,16,s.hovered?10:11);
        if(s.hovered){ellipse(68,121,2,2,'#765c98');ellipse(76,121,2,2,'#765c98');}
      }
      if(s.state==='done') {
        c.beginPath();c.moveTo(47,125);c.quadraticCurveTo(13,86,25,44);c.moveTo(111,128);c.quadraticCurveTo(148,86,135,44);c.strokeStyle='#9691d6';c.lineWidth=8;c.lineCap='round';c.stroke();
        panel(15,5,130,39,'#ffefd1');
        ellipse(23,6,7,5,'#c4e9d4','#93c9b0');ellipse(137,6,7,5,'#d8c7f5','#b49cdb');
        ellipse(23,34,3,2,'#f6b2c5');ellipse(137,34,3,2,'#f6b2c5');
        text('本次 TOKEN',80,16,10);text(s.tokenText,80,32,s.tokenText.length>12?10:13);
        paw(25,43,-.5);paw(135,43,.5);
      }
      if(s.sleeping) {
        for(let i=0;i<5;i++){
          const cy=51+(reduced?i*7:(a/45+i*17)%49),cx=16+i*31;
          ellipse(cx,cy,14,10,'#edbf50','#c79431');ellipse(cx,cy-1,12,8,'#ffe39a','#fff0b8');
          text('token',cx,cy-1,6.7,'#88551f');
        }
        bubbleBox(7,4,146,28,'#fff7e7');
        text(typed,80,18,10);ellipse(70,42,4,3,'#fff7e7');ellipse(65,48,2,2,'#fff7e7');
        c.save();c.globalAlpha=reduced?.75:.08+.92*(1+Math.sin(a/650))/2;
        text('zzz',29,107+(reduced?0:Math.sin(a/650)*2),13,'#8775b6');c.restore();
      }
      if(s.state==='asking'||s.state==='error'){bubbleBox(30,4,100,24,'#fff2fa');text(typed,80,16,10);}
    }
    function hidden(){return canvas.ownerDocument && canvas.ownerDocument.hidden;}
    function schedule(){if(!disposed && controller.snapshot().active && !hidden() && frame===null) frame=request(tick);}
    function tick(){frame=null;if(disposed||hidden()||!controller.snapshot().active)return;const t=now();
      // 减少动态不播放位移动画，但保留低频计时检查以在十分钟整进入睡眠。
      if(t-lastDraw >= (media.matches?250:1000/30)){draw(t);lastDraw=t;}schedule();}
    function redraw(){if(disposed)return;draw(now());lastDraw=now();schedule();}
    function stop(){if(frame!==null)cancel(frame);frame=null;}
    function visibility(){stop();if(!hidden())redraw();}
    function hover(on){controller.hover(on);redraw();}
    const enter=()=>hover(true),leave=()=>hover(false);
    const stage=canvas.parentElement || canvas;
    stage.addEventListener('pointerenter',enter);stage.addEventListener('pointerleave',leave);
    const doc=canvas.ownerDocument;
    if(doc)doc.addEventListener('visibilitychange',visibility);
    if(media.addEventListener)media.addEventListener('change',redraw);else if(media.addListener)media.addListener(redraw);
    ['body','sprout','arms'].forEach(name=>{
      const image=new root.Image();assets[name]=image;assetStatus[name]='loading';
      image.onload=()=>{if(disposed)return;assetStatus[name]='ready';redraw();};
      image.onerror=()=>{if(disposed)return;assetStatus[name]='error';redraw();};
      image.src=`assets/pet-yaya/${name}.png`;
    });
    function dispose(){if(disposed)return;disposed=true;stop();controller.dispose();
      stage.removeEventListener('pointerenter',enter);stage.removeEventListener('pointerleave',leave);
      if(doc)doc.removeEventListener('visibilitychange',visibility);
      if(media.removeEventListener)media.removeEventListener('change',redraw);else if(media.removeListener)media.removeListener(redraw);
      Object.values(assets).forEach(image=>{image.onload=null;image.onerror=null;});c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,canvas.width,canvas.height);
    }
    return {setState(character,state,meta){if(disposed)return;controller.setState(character,state,meta);stop();redraw();},hover,
      wake(){const woke=controller.wake();if(woke){writer.reset();redraw();}return woke;},
      hit(x,y){if(!controller.snapshot().active)return false;const r=canvas.getBoundingClientRect();return r.width>0&&r.height>0&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;},
      snapshot(){return {...controller.snapshot(),reduced:!!media.matches,frame,assets:{...assetStatus}};},dispose,destroy:dispose};
  }
  root.petYayaMarkup=petYayaMarkup;root.createPetYaya=createPetYaya;root.createPetYayaController=createPetYayaController;
  if(typeof module==='object'&&module.exports)module.exports={petYayaMarkup,createPetYaya,createPetYayaController,SLEEP_AFTER};
})(typeof window!=='undefined'?window:globalThis);
