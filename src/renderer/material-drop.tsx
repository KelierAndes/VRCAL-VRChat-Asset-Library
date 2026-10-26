import React,{useEffect,useState} from 'react';
import {t,useLanguage} from './i18n';
import './material-drop.css';

/** Only native file drags are accepted. Text, links and image URLs never become paths. */
export function MaterialDropTarget({disabled,onDrop,onBlocked,mode='materials'}:{disabled:boolean;onDrop:(files:File[])=>void;onBlocked:()=>void;mode?:'materials'|'project'}){
 useLanguage();const [over,setOver]=useState(false);
 useEffect(()=>{
  let depth=0;const isFiles=(event:DragEvent)=>Array.from(event.dataTransfer?.types??[]).includes('Files');
  const enter=(event:DragEvent)=>{if(!isFiles(event))return;event.preventDefault();depth++;setOver(true)};
  const drag=(event:DragEvent)=>{if(!isFiles(event))return;event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect=disabled?'none':'copy';setOver(true)};
  const leave=(event:DragEvent)=>{if(!isFiles(event))return;depth=Math.max(0,depth-1);if(!depth)setOver(false)};
  const drop=(event:DragEvent)=>{if(!isFiles(event))return;event.preventDefault();event.stopPropagation();depth=0;setOver(false);if(disabled){onBlocked();return}const files=Array.from(event.dataTransfer?.files??[]);if(files.length)onDrop(files)};
  const reset=()=>{depth=0;setOver(false)};
  window.addEventListener('dragenter',enter,true);window.addEventListener('dragover',drag,true);window.addEventListener('dragleave',leave,true);window.addEventListener('drop',drop,true);window.addEventListener('dragend',reset);window.addEventListener('blur',reset);
  return()=>{window.removeEventListener('dragenter',enter,true);window.removeEventListener('dragover',drag,true);window.removeEventListener('dragleave',leave,true);window.removeEventListener('drop',drop,true);window.removeEventListener('dragend',reset);window.removeEventListener('blur',reset)};
 },[disabled,onDrop,onBlocked]);
 return over?<div className={`material-drop-overlay ${disabled?'blocked':''}`} role="status" data-material-drop><div><span className="material-drop-symbol" aria-hidden="true">＋</span><strong>{disabled?t('请先完成当前操作'):mode==='project'?'松开以添加并选择 Unity 工程':t('松开以添加素材')}</strong><p>{mode==='project'?'登记所选工程，并检查工程准备情况。':t('只识别拖入的内容，不重新扫描整个资料库。')}</p><small>{mode==='project'?'请拖入一个包含 Assets、Packages 和 ProjectSettings 的工程文件夹。':t('支持文件夹、ZIP、RAR、7z、Unitypackage 等本地素材。')}</small></div></div>:null;
}
