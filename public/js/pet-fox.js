/* Original illustration layers; no network or generated replacement artwork. */
(function () {
  'use strict';
  window.petFoxMarkup = function () {
    return `<div id="fox" class="actor" role="img" aria-label="绘本小狐狸">
      <style>
        #fox {display:none;animation:none!important;filter:none;width:140px;height:140px;}
        .c-fox #fox {display:block;}
        .c-fox #cat,.c-fox #photo,.c-fox #shadow,.c-fox #halo,.c-fox #spin {display:none;}
        .c-fox #stage {width:140px;height:146px;flex-shrink:0;}
        .c-fox #bubble {z-index:2;max-height:34px;overflow:auto;flex-shrink:1;}
        .c-fox #fx {top:16px;width:140px;}
        .c-fox #qmark {left:4px;}
        .c-fox #zzz {left:104px;top:18px;}
        .c-fox #drop {right:18px;top:68px;}
        #fox img,.fox-head {position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}
        .fox-tail {transform-origin:67% 85%;animation:fox-tail 4.7s ease-in-out infinite;}
        .fox-head {transform-origin:47% 63%;animation:fox-head 5.9s ease-in-out infinite;}
        .fox-lids {opacity:0;}
        .blinking .fox-lids,.s-sleep .fox-lids {opacity:1;}
        .s-working .fox-head {animation:fox-nod 1.3s ease-in-out infinite;}
        .s-working .fox-tail {animation-duration:2.1s;}
        .s-asking .fox-head {animation:fox-curious 1.7s ease-in-out infinite;}
        .s-done .fox-tail {animation-duration:1.15s;}
        .s-error .fox-head {animation:fox-worry 1.9s ease-in-out infinite;}
        .s-sleep .fox-head {animation-duration:8s;}
        .s-sleep .fox-tail {animation-duration:9s;}
        @keyframes fox-tail {0%,100%{transform:rotate(-1.6deg)}50%{transform:rotate(2deg)}}
        @keyframes fox-head {0%,100%{transform:rotate(-.65deg)}50%{transform:rotate(.65deg)}}
        @keyframes fox-nod {0%,100%{transform:rotate(-.5deg) translateY(0)}50%{transform:rotate(.65deg) translateY(.5px)}}
        @keyframes fox-curious {0%,100%{transform:rotate(-1deg)}50%{transform:rotate(.5deg)}}
        @keyframes fox-worry {0%,100%{transform:rotate(-.8deg)}50%{transform:rotate(.8deg)}}
        @media(prefers-reduced-motion:reduce) {
          #fox,#fox * {animation:none!important;transition:none!important;}
          .blinking .fox-lids {opacity:0;}
          .s-sleep .fox-lids {opacity:1;}
        }
      </style>
      <img class="fox-tail" src="assets/pet-fox/tail.png" alt="" draggable="false">
      <img class="fox-body" src="assets/pet-fox/body.png" alt="" draggable="false">
      <div class="fox-head"><img src="assets/pet-fox/head.png" alt="" draggable="false"><img class="fox-lids" src="assets/pet-fox/eyelids.png" alt="" draggable="false"></div>
    </div>`;
  };
  const masks = new WeakMap();
  // Inverse-map pointer coordinates through each independently animated image.
  window.petFoxHit = function (x, y) {
    const fox = document.getElementById('fox');
    if (!fox || getComputedStyle(fox).display === 'none') return false;
    const r = fox.getBoundingClientRect();
    return [...fox.querySelectorAll('img:not(.fox-lids)')].some(img => {
      if (!img.complete || !img.naturalWidth) return false;
      let data = masks.get(img);
      if (!data) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', {willReadFrequently:true});
        ctx.drawImage(img,0,0); data = ctx.getImageData(0,0,canvas.width,canvas.height).data;
        masks.set(img,data);
      }
      const target = img.parentElement.classList.contains('fox-head') ? img.parentElement : img;
      const style = getComputedStyle(target);
      const origin = style.transformOrigin.split(' ').map(parseFloat);
      const matrix = new DOMMatrix(style.transform === 'none' ? undefined : style.transform);
      const p = new DOMPoint(x-r.left-origin[0],y-r.top-origin[1]).matrixTransform(matrix.inverse());
      const px = Math.floor((p.x+origin[0])/r.width*img.naturalWidth);
      const py = Math.floor((p.y+origin[1])/r.height*img.naturalHeight);
      return px>=0 && py>=0 && px<img.naturalWidth && py<img.naturalHeight && data[(py*img.naturalWidth+px)*4+3]>32;
    });
  };
})();
