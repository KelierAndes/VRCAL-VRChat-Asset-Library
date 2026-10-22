import {LANGUAGE_IDS,type AppLanguage} from './contracts';
import {DIALOG_MESSAGES} from './messages-dialogs';
import {UI_MESSAGES} from './messages-ui';
import {NATIVE_MESSAGES} from './messages-native';
import {ENGINE_MESSAGES,translateAppMessage} from './messages-engine';
import {translateRecycleMessage} from './messages-recycle';
export function normalizeLanguage(value:unknown):AppLanguage {return LANGUAGE_IDS.includes(value as AppLanguage)?value as AppLanguage:'zh-CN'}
export function translate(source:string,language:AppLanguage='zh-CN',values:Record<string,string|number>={}):string {
 const selected=normalizeLanguage(language),entry=Object.hasOwn(UI_MESSAGES,source)?UI_MESSAGES[source]:Object.hasOwn(NATIVE_MESSAGES,source)?NATIVE_MESSAGES[source]:Object.hasOwn(DIALOG_MESSAGES,source)?DIALOG_MESSAGES[source]:undefined;
 if(!entry){const recycleMessage=translateRecycleMessage(source,selected);if(recycleMessage!==undefined)return recycleMessage;const appMessage=translateAppMessage(source,selected,values);if(appMessage!==undefined)return appMessage;}
 const text=selected==='zh-CN'||!entry?source:entry[selected==='en'?0:1];
 return text.replace(/\{([A-Za-z0-9_]+)\}/g,(whole,key)=>Object.hasOwn(values,key)?String(values[key]):whole);
}
export function localizedMessages(language:AppLanguage):Record<string,string>{return Object.fromEntries(Object.keys({...UI_MESSAGES,...NATIVE_MESSAGES,...DIALOG_MESSAGES,...ENGINE_MESSAGES}).map(key=>[key,translate(key,language)]))}
export function localizeDialogOptions<T extends object>(options:T,language:AppLanguage):T {
 const result={...options} as Record<string,unknown>;
 for(const key of ['title','message','detail','buttonLabel','checkboxLabel'])if(typeof result[key]==='string')result[key]=translate(result[key] as string,language);
 if(Array.isArray(result.buttons))result.buttons=result.buttons.map(text=>typeof text==='string'?translate(text,language):text);
 if(Array.isArray(result.filters))result.filters=result.filters.map(filter=>({...filter,name:typeof filter.name==='string'?translate(filter.name,language):filter.name}));
 return result as T;
}
