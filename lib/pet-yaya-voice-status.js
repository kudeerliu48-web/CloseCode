'use strict';
const fs=require('fs'),path=require('path');
const {safeVoiceFile}=require('../public/js/pet-yaya-voice');
module.exports=function voiceStatus(base=path.join(__dirname,'../public/assets/pet-yaya-voice')){
  try{
    const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8'));
    const entries=Object.values(manifest.states||{}),files=new Set(),missing=[];
    for(const entry of entries){
      let valid=false;
      if(entry.available===true&&safeVoiceFile(entry.file)){
        try{const file=path.resolve(base,entry.file),stat=fs.statSync(file);valid=stat.isFile()&&stat.size>0&&fs.realpathSync(file)===file;}catch(_){}
      }
      if(valid)files.add(entry.file);else missing.push(entry.file||'invalid');
    }
    return {ready:entries.length>0&&missing.length===0,files:files.size,missing};
  }catch(_){return {ready:false,files:0,missing:['manifest.json']};}
};
