/* Procedural canvas actor. One monotonic deadline, no catch-up queue. */
(function () {
  'use strict';
  window.petMuyuMarkup = () => `<canvas id="muyu" class="actor" width="336" height="328" role="img" aria-label="Q版木鱼"></canvas><style>
    #muyu{display:none;width:168px;height:164px;animation:none!important;transform:none!important;filter:none}
    .c-muyu #muyu{display:block}.c-muyu #stage{width:168px;height:164px;flex-shrink:0}
    .c-muyu #cat,.c-muyu #photo,.c-muyu #fx,.c-muyu #halo,.c-muyu #shadow,.c-muyu #drop{display:none}
    .c-muyu #bubble{position:absolute;top:2px;max-height:22px;overflow:auto;margin:0;z-index:2;font-size:10px;padding:3px 6px}
    .c-muyu.s-idle #bubble,.c-muyu.s-working #bubble,.c-muyu.s-done #bubble{display:none}
  </style>`;
  function ellipse(c,x,y,rx,ry,fill,stroke) {
    c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=fill;c.fill();
    if(stroke){c.strokeStyle=stroke;c.lineWidth=1.3;c.stroke();}
  }
  function mallet(c) {
    const wood=c.createLinearGradient(-4,0,4,0);wood.addColorStop(0,'#9d5028');wood.addColorStop(.45,'#f1c383');wood.addColorStop(1,'#b46b36');
    c.fillStyle=wood;c.strokeStyle='#794221';c.lineWidth=1.2;c.beginPath();c.roundRect(-4,-3,8,43,4);c.fill();c.stroke();
    const head=c.createRadialGradient(-4,-15,2,0,-10,16);head.addColorStop(0,'#ffe3ae');head.addColorStop(.5,'#dfab68');head.addColorStop(1,'#995128');
    ellipse(c,0,-11,14,12,head,'#804521');ellipse(c,-4,-16,6,2.5,'#fff0ca90');
    c.strokeStyle='#ae713b70';c.beginPath();c.ellipse(0,-11,10,8,0,.2,2.4);c.stroke();
  }
  window.createPetMuyu = function (canvas, options = {}) {
    const now=options.now || (()=>performance.now());
    const request=options.request || requestAnimationFrame;
    const cancel=options.cancel || cancelAnimationFrame;
    const media=options.media || matchMedia('(prefers-reduced-motion: reduce)');
    const c=canvas.getContext('2d');
    let active=false,state='idle',next=Infinity,struck=null,frame=null,hover=false,count=0;
    // 与自动木槌共用原始绘制尺寸，不再把鼠标木槌缩小到 0.6 倍。
    const cursor=document.createElement('canvas');cursor.width=80;cursor.height=80;
    const cc=cursor.getContext('2d');cc.translate(30,32);cc.rotate(-.05);mallet(cc);
    const cursorValue=`url("${cursor.toDataURL()}") 31 10, pointer`;
    function setCursor(){document.body.style.cursor=active&&state!=='working'&&hover?cursorValue:'';}
    function hit(x,y) {
      if(!active)return false;const r=canvas.getBoundingClientRect();
      return r.width>0&&r.height>0&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;
    }
    function draw(t) {
      c.setTransform(2,0,0,2,0,0);c.clearRect(0,0,168,164);
      ellipse(c,82,151,62,7,'#33201725');
      const cushion=c.createLinearGradient(0,132,0,153);cushion.addColorStop(0,'#ac6b55');cushion.addColorStop(1,'#60382e');
      ellipse(c,80,142,58,12,cushion,'#59352b');ellipse(c,80,138,55,9,'#c58a65','#e9b983');
      c.strokeStyle='#f3c68a';c.lineWidth=1;c.setLineDash([2,3]);c.beginPath();c.ellipse(80,142,52,7,0,.1,3.04);c.stroke();c.setLineDash([]);
      const body=new Path2D('M 22 109 C 18 83 36 65 69 65 C 101 64 123 80 133 102 C 144 126 117 142 81 143 C 43 145 22 132 22 109 Z');
      const wood=c.createRadialGradient(56,80,4,80,108,65);wood.addColorStop(0,'#ffe0a3');wood.addColorStop(.38,'#dfa05a');wood.addColorStop(.75,'#b36c34');wood.addColorStop(1,'#79401f');
      c.fillStyle=wood;c.fill(body);c.strokeStyle='#713b21';c.lineWidth=2;c.stroke(body);
      c.save();c.clip(body);
      for(let i=0;i<8;i++){c.strokeStyle=i%2?'#ffe3ab38':'#74391835';c.lineWidth=i%2?1.3:1.8;c.beginPath();c.ellipse(57,94,24+i*8,13+i*5,-.22,.15,5.65);c.stroke();}
      c.restore();
      c.save();c.translate(55,80);c.rotate(-.25);ellipse(c,0,0,20,5,'#fff1c48c');c.restore();
      // A carved fish-mouth channel, inset edge and curled eye.
      const mouth=new Path2D('M 41 112 C 60 122 105 121 126 106 C 130 104 132 109 128 113 C 105 135 63 134 40 118 C 35 115 36 109 41 112 Z');
      c.strokeStyle='#efb874';c.lineWidth=4;c.stroke(mouth);c.fillStyle='#412719';c.fill(mouth);
      c.strokeStyle='#21170f';c.lineWidth=2;c.beginPath();c.moveTo(43,114);c.bezierCurveTo(74,128,110,118,127,109);c.stroke();
      const age=struck===null?Infinity:t-struck;
      const eyesClosed=state==='done'||state==='sleep'||(state==='working'&&!media.matches&&age>=0&&age<180);
      ellipse(c,108,98,8,7,'#b7773f','#824a27');
      if(eyesClosed){c.strokeStyle='#4d2b1c';c.lineWidth=2;c.lineCap='round';c.beginPath();c.moveTo(104,97);c.quadraticCurveTo(109,102,114,97);c.stroke();}
      else {ellipse(c,109,97,3.3,3.3,'#4d2b1c');ellipse(c,108,96,1,1,'#fbd699');}
      if(state==='done'){
        c.save();c.font='800 22px "Microsoft YaHei", sans-serif';c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';
        c.lineWidth=4;c.strokeStyle='#704320';c.strokeText('功德圆满',84,30);c.fillStyle='#ffe3a0';c.fillText('功德圆满',84,30);c.restore();
      }
      let angle=-.05;
      if(age<180&&!media.matches)angle=-.95+.9*(age/180);
      else if(active&&state==='working'&&!media.matches&&next-t<230){const p=(230-(next-t))/230;angle=p<.5?-.05+.5*p:.2-1.15*(p-.5)*2;}
      if(state==='working') {c.save();c.translate(139,120);c.rotate(angle);c.translate(0,-34);mallet(c);c.restore();}
      if(age>=0&&age<(media.matches?400:800)){
        const progress=age/800;c.save();c.globalAlpha=media.matches?1:Math.min(1,(1-progress)*2);
        c.font='800 22px "Microsoft YaHei", sans-serif';c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';
        c.lineWidth=4;c.strokeStyle='#704320';const y=media.matches?27:35-progress*20;
        c.strokeText('功德+1',80,y);const gold=c.createLinearGradient(0,y-12,0,y+12);gold.addColorStop(0,'#fffce3');gold.addColorStop(1,'#ffd36c');c.fillStyle=gold;c.fillText('功德+1',80,y);
        c.restore();
      }
    }
    function strike(t){struck=t;count++;canvas.dispatchEvent(new CustomEvent('muyu-strike',{detail:{count,time:t}}));}
    function tick(){frame=null;if(!active)return;const t=now();
      if(state==='working'&&t>=next){strike(t);next=t+1000;}
      if(struck!==null&&t-struck>=(media.matches?400:800))struck=null;
      draw(t);if(state==='working'||struck!==null)frame=request(tick);
    }
    function schedule(){if(frame===null&&active&&(state==='working'||struck!==null))frame=request(tick);}
    function clear(){if(frame!==null)cancel(frame);frame=null;struck=null;next=Infinity;hover=false;setCursor();}
    function setState(character,s){const on=character==='muyu';if(on===active&&s===state)return;
      clear();active=on;state=s;setCursor();if(active){next=state==='working'?now()+1000:Infinity;draw(now());schedule();}}
    function manual(){if(!active||state!=='idle')return false;strike(now());draw(now());schedule();return true;}
    function visibility(){if(frame!==null)cancel(frame);frame=null;struck=null;next=active&&state==='working'?now()+1000:Infinity;if(active)draw(now());if(!document.hidden)schedule();}
    function reduced(){struck=null;if(active)draw(now());}
    document.addEventListener('visibilitychange',visibility);media.addEventListener('change',reduced);
    draw(now());
    return {setState,manual,hit,hover(on){hover=on;setCursor();},clear,
      dispose(){clear();active=false;document.removeEventListener('visibilitychange',visibility);media.removeEventListener('change',reduced);},
      snapshot(){return {active,state,next,struck,count,frame,hover,reduced:media.matches};}};
  };
})();
