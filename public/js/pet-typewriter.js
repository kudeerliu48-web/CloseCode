/* 桌宠统一逐字显示：同一句重复推送不重启，Unicode 字素完整输出。 */
(function(root){
  'use strict';
  function createPetTypewriter({now=()=>performance.now(),interval=70}={}) {
    const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh-CN',{granularity:'grapheme'}):null;
    let identity=null,chars=[],started=0,full='';
    return {
      sample(value,{key='',visible=true,reduced=false}={}) {
        if(!visible){identity=null;chars=[];full='';return {text:'',done:true};}
        const next=String(value||''),id=key+'\0'+next;
        if(id!==identity){identity=id;full=next;chars=segmenter?Array.from(segmenter.segment(next),s=>s.segment):Array.from(next);started=now();}
        const count=reduced?chars.length:Math.min(chars.length,Math.floor(Math.max(0,now()-started)/interval));
        return {text:count===chars.length?full:chars.slice(0,count).join(''),done:count===chars.length};
      },
      reset(){identity=null;chars=[];full='';}
    };
  }
  root.createPetTypewriter=createPetTypewriter;
  if(typeof module==='object'&&module.exports)module.exports={createPetTypewriter};
})(typeof window!=='undefined'?window:globalThis);
